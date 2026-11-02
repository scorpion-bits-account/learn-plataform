import 'server-only';

import { z } from 'zod';

import { getPaymentsEnv } from '@/lib/env/server';
import { safeEqual, verifyWebhookSignature } from '@/lib/payments/abacatepay-webhook';
import {
  PaymentProviderError,
  getCardCheckoutStatus as defaultGetCardCheckoutStatus,
  getPixStatus as defaultGetPixStatus,
  type CardCheckoutStatusResult,
  type PixStatusResult,
} from '@/lib/payments/abacatepay';
import { providerVerdict, type RemoteChargeState } from '@/lib/payments/verdict';
import type { Json } from '@/types/database';

import {
  WebhookTransientError,
  createWebhookStore,
  type WebhookOrder,
  type WebhookStore,
} from './store';

/**
 * Webhook da AbacatePay (docs/payments.md §4–§5, PAY-003; cartão §10, PAY-007).
 * Lógica pura: a rota só adapta Request/Response.
 *
 * - `transparent.*` → pedidos PIX, reconsulta `GET /transparents/check`;
 * - `checkout.*` → pedidos de cartão (checkout hospedado), reconsulta `GET /checkouts/get`.
 *
 * Garantias:
 * - origem pelo `webhookSecret` (tempo constante) e integridade pelo HMAC do corpo bruto;
 * - dedupe por `payment_events.provider_event_id`;
 * - acesso SÓ por `fulfill_order` (após reconsultar a cobrança = PAID com a nossa
 *   chave) e revogação SÓ por `refund_order`;
 * - 5xx apenas para falha transitória (banco/provedor indisponível, ou reconsulta
 *   ainda `PENDING` em `completed` → 503), para a AbacatePay re-tentar;
 *   erro de dado → 200 + `payment_events.processing_error`.
 */

export const MAX_BODY_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface WebhookInput {
  /** Valor de `?webhookSecret=` (nunca logar). */
  webhookSecret: string | null;
  /** Header `X-Webhook-Signature`. */
  signature: string | null;
  /** Header `Content-Length` (opcional; corta cedo corpos grandes). */
  contentLength: string | null;
  /** Lê o corpo bruto com limite; `null` = passou do limite. */
  readBody: (maxBytes: number) => Promise<string | null>;
}

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; result: string };
}

export interface WebhookConfig {
  webhookSecret: string;
  apiKey: string;
}

type LogLevel = 'info' | 'warn' | 'error';
export type WebhookLogger = (level: LogLevel, message: string, fields?: LogFields) => void;

/** Campos de log permitidos: sem payload, URL, segredo ou dados pessoais. */
export interface LogFields {
  eventId?: string;
  eventType?: string;
  orderId?: string | null;
  result?: string;
  code?: string;
  status?: number;
}

export interface WebhookDeps {
  getConfig: () => WebhookConfig;
  getStore: () => WebhookStore;
  getPixStatus: (billingId: string) => Promise<PixStatusResult>;
  getCardCheckoutStatus: (billingId: string) => Promise<CardCheckoutStatusResult>;
  log: WebhookLogger;
}

// ---------------------------------------------------------------------------
// Payload: só os campos usados (a AbacatePay recomenda não validar tudo)
// ---------------------------------------------------------------------------

/** Campo opcional tolerante: tipo inesperado vira `undefined` em vez de recusar o evento. */
const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const chargeSchema = z.object({
  id: loose(z.string().trim().min(1).max(128)),
  externalId: loose(z.string().trim().min(1).max(128)),
  amount: loose(z.number().int()),
  paidAmount: loose(z.number().int()),
  status: loose(z.string().max(40)),
});

const eventSchema = z.object({
  id: loose(z.string().trim().min(1).max(200)),
  event: z.string().trim().min(1).max(100),
  devMode: loose(z.boolean()),
  data: z.object({
    transparent: loose(chargeSchema),
    checkout: loose(chargeSchema),
    reason: loose(z.string().max(200)),
  }),
});

type WebhookEvent = z.infer<typeof eventSchema>;
type Charge = z.infer<typeof chargeSchema>;

/** Família do evento: `transparent.*` (PIX) ou `checkout.*` (cartão, checkout hospedado). */
type EventKind = 'pix' | 'card';

function eventKind(event: string): EventKind | null {
  if (event.startsWith('transparent.')) return 'pix';
  if (event.startsWith('checkout.')) return 'card';
  return null;
}

/** Cobrança do evento conforme a família (`data.transparent` ou `data.checkout`). */
function chargeOf(evt: WebhookEvent): Charge | undefined {
  return eventKind(evt.event) === 'card' ? evt.data.checkout : evt.data.transparent;
}

const uuidSchema = z.uuid();

// ---------------------------------------------------------------------------
// Utilitários puros
// ---------------------------------------------------------------------------

/** Lê um stream até `maxBytes`; `null` se passar do limite (o stream é cancelado). */
export async function readLimitedText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Chave de produção da AbacatePay (`abc_prod_…`). */
export function isProductionKey(apiKey: string): boolean {
  return apiKey.startsWith('abc_prod_');
}

/**
 * Compara o id da cobrança do evento com o gravado no pedido. Tolera o prefixo
 * `pix_` (a doc mostra `char_…` no evento e o create devolve `pix_char_…` —
 * docs/payments.md §4.3, A CONFIRMAR em Dev).
 */
export function sameBillingId(stored: string, fromEvent: string): boolean {
  return stored === fromEvent || stored === `pix_${fromEvent}` || `pix_${stored}` === fromEvent;
}

/** Corpo guardado em `payment_events.payload`: só os campos usados (sem dados do pagador). */
function storedPayload(evt: WebhookEvent): Json {
  const charge = chargeOf(evt);
  const reduced = charge
    ? {
        id: charge.id ?? null,
        externalId: charge.externalId ?? null,
        amount: charge.amount ?? null,
        paidAmount: charge.paidAmount ?? null,
        status: charge.status ?? null,
      }
    : null;
  return {
    id: evt.id ?? null,
    event: evt.event,
    devMode: evt.devMode ?? null,
    data: {
      [eventKind(evt.event) === 'card' ? 'checkout' : 'transparent']: reduced,
      reason: evt.data.reason ?? null,
    },
  };
}

const reply = (status: number, result: string, ok = status < 400): WebhookResponse => ({
  status,
  body: { ok, result },
});

const defaultLog: WebhookLogger = (level, message, fields) => {
  console[level](`[webhook:abacatepay] ${message}`, fields ?? {});
};

export function defaultWebhookDeps(): WebhookDeps {
  return {
    getConfig: () => {
      const env = getPaymentsEnv();
      return { webhookSecret: env.ABACATEPAY_WEBHOOK_SECRET, apiKey: env.ABACATEPAY_API_KEY };
    },
    getStore: () => createWebhookStore(),
    getPixStatus: defaultGetPixStatus,
    getCardCheckoutStatus: defaultGetCardCheckoutStatus,
    log: defaultLog,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Erro de dado: registrado no evento, resposta 200 (não adianta re-tentar). */
class DataError extends Error {
  constructor(
    readonly code: string,
    readonly orderId: string | null,
  ) {
    super(code);
  }
}

/**
 * O provedor ainda não refletiu o pagamento (`check` = `PENDING` em `completed`):
 * transitório. O evento fica "não processado" e a resposta é 503 para a
 * AbacatePay re-tentar (até 7x em ~18 h); a re-tentativa cai no caminho `retry`.
 */
class ProviderPendingError extends Error {
  constructor(readonly orderId: string) {
    super('provider_pending');
  }
}

export async function handleAbacatePayWebhook(
  input: WebhookInput,
  deps: WebhookDeps = defaultWebhookDeps(),
): Promise<WebhookResponse> {
  const { log } = deps;

  // 0. Configuração (sem env: indisponível, a AbacatePay re-tenta).
  let config: WebhookConfig;
  try {
    config = deps.getConfig();
  } catch {
    log('error', 'pagamentos não configurados');
    return reply(503, 'not_configured');
  }

  // 1. Origem: segredo da query string, em tempo constante.
  if (!safeEqual(input.webhookSecret ?? '', config.webhookSecret)) {
    log('warn', 'segredo inválido');
    return reply(401, 'unauthorized');
  }

  // 2. Corpo bruto com limite de tamanho.
  const declared = Number(input.contentLength);
  if (input.contentLength && Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return reply(413, 'payload_too_large');
  }
  const raw = await input.readBody(MAX_BODY_BYTES);
  if (raw === null) return reply(413, 'payload_too_large');

  // 3. Integridade: HMAC sobre o corpo bruto, antes de qualquer parse.
  if (!verifyWebhookSignature(raw, input.signature)) {
    log('warn', 'assinatura inválida');
    return reply(401, 'invalid_signature');
  }

  // 4. Parse mínimo.
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    log('warn', 'corpo ilegível');
    return reply(400, 'invalid_payload');
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    log('warn', 'payload sem os campos esperados');
    return reply(400, 'invalid_payload');
  }
  const evt = parsed.data;
  const charge = chargeOf(evt);
  const kind = eventKind(evt.event);
  // Sem `id` de topo (pendência 1 do payments.md): chave determinística por evento+cobrança.
  const eventId = evt.id ?? (charge?.id ? `${evt.event}:${charge.id}` : null);
  if (!eventId) {
    log('warn', 'evento sem id', { eventType: evt.event });
    return reply(400, 'invalid_payload');
  }
  const fields = { eventId, eventType: evt.event };

  // 5. Ambiente: em produção, eventos de Dev mode são ignorados (200: não re-tentar).
  if (isProductionKey(config.apiKey) && evt.devMode === true) {
    log('warn', 'evento de Dev mode recebido em produção: ignorado', fields);
    return reply(200, 'ignored_dev_mode');
  }

  let store: WebhookStore | undefined;
  try {
    store = deps.getStore();

    // 6. Dedupe.
    const recorded = await store.recordEvent({
      providerEventId: eventId,
      eventType: evt.event,
      payload: storedPayload(evt),
    });
    if (recorded === 'duplicate') {
      log('info', 'evento duplicado', fields);
      return reply(200, 'duplicate');
    }

    // 7. Roteamento.
    const ctx: Ctx = {
      store,
      deps,
      eventId,
      charge,
      kind: kind ?? 'pix',
      log: (l, m, f) => log(l, m, { ...fields, ...f }),
    };
    switch (evt.event) {
      case 'transparent.completed':
      case 'checkout.completed':
        return reply(200, await processCompleted(ctx));
      case 'transparent.refunded':
      case 'transparent.lost':
      case 'checkout.refunded':
      case 'checkout.lost':
        return reply(200, await processRefund(ctx));
      case 'transparent.disputed':
      case 'checkout.disputed':
        return reply(200, await processDispute(ctx, evt.data.reason));
      default:
        throw new DataError('unsupported_event', null);
    }
  } catch (error) {
    if (error instanceof DataError && store) {
      try {
        await store.markEvent(eventId, {
          orderId: error.orderId,
          processed: false,
          error: error.code,
        });
      } catch (markError) {
        return transientReply(markError, log, fields);
      }
      log('warn', 'evento com erro de dado', {
        ...fields,
        orderId: error.orderId,
        result: error.code,
      });
      return reply(200, error.code);
    }
    if (error instanceof ProviderPendingError) {
      log('warn', 'reconsulta ainda PENDING: o provedor vai re-tentar', {
        ...fields,
        orderId: error.orderId,
        result: 'provider_pending',
      });
      return reply(503, 'provider_pending', false);
    }
    return transientReply(error, log, fields);
  }
}

function transientReply(error: unknown, log: WebhookLogger, fields: LogFields): WebhookResponse {
  const detail: LogFields =
    error instanceof PaymentProviderError
      ? { code: error.code, status: error.status }
      : error instanceof WebhookTransientError
        ? { code: error.code ?? error.message }
        : { code: 'unexpected' };
  log('error', 'falha transitória: o provedor vai re-tentar', { ...fields, ...detail });
  return reply(500, 'temporary_failure', false);
}

// ---------------------------------------------------------------------------
// Processamento por evento
// ---------------------------------------------------------------------------

interface Ctx {
  store: WebhookStore;
  deps: WebhookDeps;
  eventId: string;
  charge: Charge | undefined;
  kind: EventKind;
  log: WebhookLogger;
}

/**
 * Pedido pelo `externalId` (= `orders.id`). O método do pedido precisa ser o da
 * família do evento (evento de checkout nunca mexe em pedido PIX e vice-versa).
 */
async function resolveOrder(ctx: Ctx): Promise<WebhookOrder> {
  const externalId = ctx.charge?.externalId;
  if (!externalId || !uuidSchema.safeParse(externalId).success) {
    throw new DataError('order_not_found', null);
  }
  const order = await ctx.store.findOrder(externalId);
  if (!order) throw new DataError('order_not_found', null);
  if ((order.paymentMethod ?? 'pix') !== ctx.kind || order.provider !== 'abacatepay') {
    throw new DataError('method_mismatch', order.id);
  }
  return order;
}

/**
 * Cobrança a reconsultar: a gravada no pedido (fonte da verdade). Pedido sem
 * cobrança gravada (timeout no PAY-002) usa a do evento, se nenhum outro pedido a usa.
 */
async function resolveBillingId(ctx: Ctx, order: WebhookOrder): Promise<string> {
  const fromEvent = ctx.charge?.id;
  if (order.providerBillingId) {
    if (fromEvent && !sameBillingId(order.providerBillingId, fromEvent)) {
      throw new DataError('billing_mismatch', order.id);
    }
    return order.providerBillingId;
  }
  if (!fromEvent || order.provider !== 'abacatepay') {
    throw new DataError('billing_mismatch', order.id);
  }
  if (await ctx.store.isBillingUsedByAnotherOrder(fromEvent, order.id)) {
    throw new DataError('billing_mismatch', order.id);
  }
  return fromEvent;
}

/**
 * Reconsulta autenticada pela nossa chave (PIX: `transparents/check`; cartão:
 * `checkouts/get`). Recusa do provedor (4xx) é erro de dado.
 */
async function checkCharge(
  ctx: Ctx,
  order: WebhookOrder,
  billingId: string,
): Promise<RemoteChargeState> {
  try {
    return ctx.kind === 'card'
      ? await ctx.deps.getCardCheckoutStatus(billingId)
      : await ctx.deps.getPixStatus(billingId);
  } catch (error) {
    if (error instanceof PaymentProviderError && error.code === 'invalid_request') {
      throw new DataError('provider_check_rejected', order.id);
    }
    throw error; // indisponível/não autorizado: transitório
  }
}

const FULFILLABLE = new Set(['pending', 'expired', 'failed']);

async function processCompleted(ctx: Ctx): Promise<string> {
  const order = await resolveOrder(ctx);

  if (!FULFILLABLE.has(order.status)) {
    // Nada a conceder: reentrega de pedido pago ou pedido cancelado/reembolsado.
    if (order.status === 'paid') {
      await ctx.store.markEvent(ctx.eventId, { orderId: order.id, processed: true, error: null });
      ctx.log('info', 'pedido já pago', { orderId: order.id, result: 'already_paid' });
      return 'already_paid';
    }
    throw new DataError('invalid_status', order.id);
  }

  const amount = ctx.charge?.amount;
  if (amount === undefined) throw new DataError('amount_mismatch', order.id);

  const billingId = await resolveBillingId(ctx, order);
  const remote = await checkCharge(ctx, order, billingId);
  // QA-002 (S-01): o evento não é confiável sozinho (o segredo da URL pode vazar).
  // A reconsulta precisa dizer PAID e os valores informados precisam bater com o pedido.
  switch (providerVerdict(remote, order)) {
    case 'paid':
      break;
    case 'pending':
      // Atraso do provedor: transitório (503, evento segue não processado).
      throw new ProviderPendingError(order.id);
    case 'amount_mismatch':
      throw new DataError('amount_mismatch', order.id);
    case 'billing_mismatch':
      throw new DataError('billing_mismatch', order.id);
    case 'not_paid':
      throw new DataError(`provider_status_${remote.status.toLowerCase()}`, order.id);
  }

  // Único ponto que concede acesso.
  const result = await ctx.store.fulfillOrder({
    orderId: order.id,
    billingId,
    amountCents: amount,
    eventId: ctx.eventId,
  });
  const level = result === 'fulfilled' || result === 'already_paid' ? 'info' : 'warn';
  ctx.log(
    level,
    result === 'paid_already_enrolled' ? 'pagamento em duplicidade: reembolsar' : 'fulfill_order',
    {
      orderId: order.id,
      result,
    },
  );
  return result;
}

async function processRefund(ctx: Ctx): Promise<string> {
  const order = await resolveOrder(ctx);

  if (order.status === 'paid') {
    const billingId = await resolveBillingId(ctx, order);
    const remote = await checkCharge(ctx, order, billingId);
    if (remote.externalId != null && remote.externalId !== order.id) {
      throw new DataError('billing_mismatch', order.id);
    }
    if (remote.status !== 'REFUNDED') {
      throw new DataError(`provider_status_${remote.status.toLowerCase()}`, order.id);
    }
  }
  // Pedido não pago: refund_order não altera nada (already_refunded / invalid_status).

  // Único ponto que revoga acesso por reembolso.
  const result = await ctx.store.refundOrder(order.id, ctx.eventId);
  const level = result === 'refunded' || result === 'already_refunded' ? 'info' : 'warn';
  ctx.log(level, 'refund_order', { orderId: order.id, result });
  return result;
}

async function processDispute(ctx: Ctx, reason: string | undefined): Promise<string> {
  const externalId = ctx.charge?.externalId;
  const order =
    externalId && uuidSchema.safeParse(externalId).success
      ? await ctx.store.findOrder(externalId)
      : null;
  await ctx.store.markEvent(ctx.eventId, {
    orderId: order?.id ?? null,
    processed: true,
    error: null,
  });
  // Alerta para o admin: o acesso continua até o desfecho (decisão do produto).
  ctx.log(
    'warn',
    ctx.kind === 'card' ? 'ALERTA: chargeback aberto (cartão)' : 'ALERTA: disputa aberta (MED)',
    {
      orderId: order?.id ?? null,
      result: 'dispute_recorded',
      code: reason,
    },
  );
  return 'dispute_recorded';
}
