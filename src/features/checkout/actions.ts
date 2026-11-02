'use server';

import 'server-only';

import { redirect } from 'next/navigation';

import { getPublishedCourse } from '@/features/catalog/queries';
import { ActionError, userAction } from '@/lib/auth/actions';
import { getClientEnv } from '@/lib/env/client';
import {
  createCardCheckout,
  createPixCharge,
  getCardCheckoutStatus,
  getPixStatus,
  isPaymentsConfigured,
  PaymentProviderError,
} from '@/lib/payments/abacatepay';
import { providerVerdict } from '@/lib/payments/verdict';
import { isAbacatePayCheckoutUrl, resolveAbacatePayBaseUrl } from '@/lib/payments/api-base-url';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

import type { OrderStatusSnapshot } from './model';
import {
  CARD_CHECKOUT_REUSE_SECONDS,
  cardMaxInstallments,
  IN_FLIGHT_GRACE_MS,
  orderStatusInputSchema,
  PIX_EXPIRES_IN_SECONDS,
  REUSE_MIN_REMAINING_MS,
  startCheckoutSchema,
  type PaymentMethod,
} from './schemas';

/**
 * Checkout PIX (PAY-002) e cartão pelo checkout hospedado (PAY-007, ADR-022).
 * Nenhum acesso é concedido aqui: a matrícula só nasce em `fulfill_order()`,
 * chamado pelo webhook verificado (PAY-003) ou após reconsulta autenticada.
 *
 * Fronteiras de confiança:
 * - `user_id` vem da sessão (`userAction` → `requireUser`), nunca do input;
 * - o preço é lido do banco (`course_catalog.price_cents`) e congelado em `orders.amount_cents`;
 * - leituras e o perfil usam o client do usuário (RLS); só a escrita em `orders`
 *   (sem policy de INSERT/UPDATE para `authenticated`) usa o service client,
 *   sempre com valores montados aqui.
 */

export type CheckoutOutcome = { status: 'already_owned'; href: string };

const GENERIC_ERROR = 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.';
const PROVIDER_ERROR =
  'Não conseguimos gerar o PIX agora. Nenhum valor foi cobrado. Tente novamente em instantes.';
const CARD_PROVIDER_ERROR =
  'Não conseguimos abrir o pagamento com cartão agora. Nenhum valor foi cobrado. Tente novamente em instantes ou pague com PIX.';
const IN_FLIGHT_ERROR = 'Seu PIX já está sendo gerado. Aguarde alguns segundos e tente novamente.';

type ServiceClient = ReturnType<typeof createServiceClient>;
type UserClient = Awaited<ReturnType<typeof createClient>>;

type PendingOrder = {
  id: string;
  expires_at: string | null;
  pix_br_code: string | null;
  checkout_url: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
};

/** Log sem dados pessoais (nada de CPF, telefone, email ou payload do provedor). */
function logCheckoutError(step: string, orderId: string | null, error: unknown) {
  const detail =
    error instanceof PaymentProviderError
      ? { code: error.code, status: error.status, message: error.message }
      : { code: (error as { code?: unknown } | null)?.code };
  console.error(`[checkout] ${step}`, { orderId, ...detail });
}

async function findPendingOrder(
  supabase: UserClient,
  userId: string,
  courseId: string,
): Promise<PendingOrder | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, expires_at, pix_br_code, checkout_url, payment_method, created_at')
    .eq('user_id', userId) // RLS deixaria o admin ver pedidos de todos
    .eq('course_id', courseId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) {
    logCheckoutError('read pending', null, error);
    throw new ActionError(GENERIC_ERROR);
  }
  return data;
}

/** Pedido pendente já tem cobrança no provedor (QR PIX ou checkout de cartão). */
function hasCharge(order: PendingOrder): boolean {
  return Boolean(order.pix_br_code || order.checkout_url);
}

function isReusable(order: PendingOrder, method: PaymentMethod, now: number): boolean {
  if ((order.payment_method ?? 'pix') !== method) return false;
  if (!hasCharge(order) || !order.expires_at) return false;
  return Date.parse(order.expires_at) - now > REUSE_MIN_REMAINING_MS;
}

/** Para onde mandar o aluno ao reaproveitar o pedido: QR (PIX) ou o checkout hospedado. */
function reuseTarget(order: PendingOrder): string {
  if (order.payment_method === 'card' && order.checkout_url) {
    return safeCheckoutUrl(order.checkout_url) ?? `/checkout/pedido/${order.id}`;
  }
  return `/checkout/pedido/${order.id}`;
}

/** URL do checkout hospedado só se for da AbacatePay (ou do mock E2E). */
function safeCheckoutUrl(url: string): string | null {
  try {
    const base = resolveAbacatePayBaseUrl(process.env.ABACATEPAY_API_BASE_URL);
    return isAbacatePayCheckoutUrl(url, base) ? url : null;
  } catch {
    return null;
  }
}

/** URL absoluta de volta do checkout hospedado (`returnUrl`/`completionUrl`). */
function orderPageUrl(orderId: string): string {
  return new URL(`/checkout/pedido/${orderId}`, getClientEnv().NEXT_PUBLIC_SITE_URL).toString();
}

/** Muda o status de um pedido ainda `pending` (sem efeito se outro fluxo já mudou). */
async function settlePending(
  service: ServiceClient,
  orderId: string,
  status: 'expired' | 'failed',
): Promise<void> {
  const { error } = await service
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('status', 'pending');
  if (error) {
    logCheckoutError(`mark ${status}`, orderId, error);
    throw new ActionError(GENERIC_ERROR);
  }
}

/**
 * Decide o que fazer com o pedido pendente existente:
 * - mesmo método e cobrança válida → reaproveita (clique duplo, "voltar", outra aba);
 * - cobrança vencida ou outro método → `expired` e segue para um novo (se a cobrança
 *   antiga ainda for paga, `fulfill_order` aceita `expired → paid`);
 * - sem cobrança e recente → outra requisição está gerando: erro amigável;
 * - sem cobrança e antigo → tentativa abandonada: `failed` e segue para um novo.
 */
async function resolvePending(
  pending: PendingOrder,
  method: PaymentMethod,
  getService: () => ServiceClient,
): Promise<{ reuse: string } | null> {
  const now = Date.now();
  if (isReusable(pending, method, now)) return { reuse: reuseTarget(pending) };
  if (hasCharge(pending)) {
    await settlePending(getService(), pending.id, 'expired');
    return null;
  }
  if (now - Date.parse(pending.created_at) < IN_FLIGHT_GRACE_MS) {
    throw new ActionError(IN_FLIGHT_ERROR);
  }
  await settlePending(getService(), pending.id, 'failed');
  return null;
}

export const startCheckout = userAction(startCheckoutSchema, async (input, { user }) => {
  const method: PaymentMethod = input.paymentMethod;
  const providerError = method === 'card' ? CARD_PROVIDER_ERROR : PROVIDER_ERROR;

  // 1. Curso publicado e pago (preço lido do banco, nunca do input).
  const course = await getPublishedCourse(input.courseSlug);
  if (!course || !Number.isInteger(course.priceCents) || course.priceCents <= 0) {
    throw new ActionError('Este curso não está disponível para compra.');
  }

  const supabase = await createClient();

  // 2. Já tem acesso? (has_course_access com o client do usuário)
  const { data: hasAccess, error: accessError } = await supabase.rpc('has_course_access', {
    p_course_id: course.id,
  });
  if (accessError) {
    logCheckoutError('has_course_access', null, accessError);
    throw new ActionError(GENERIC_ERROR);
  }
  if (hasAccess) {
    return { status: 'already_owned', href: `/aprender/${course.slug}` } satisfies CheckoutOutcome;
  }

  // 3. PIX: CPF/telefone no próprio perfil (RLS + GRANT por coluna). Cartão: nada
  //    (o titular digita os dados no checkout da AbacatePay).
  let fullName = '';
  if (input.paymentMethod === 'pix') {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .update({ tax_id: input.taxId, phone: input.phone })
      .eq('id', user.id)
      .select('full_name')
      .maybeSingle();
    if (profileError || !profile) {
      logCheckoutError('save profile', null, profileError);
      throw new ActionError(GENERIC_ERROR);
    }
    fullName = profile.full_name;
  }

  let service: ServiceClient | undefined;
  const getService = () => (service ??= createServiceClient());

  // 4. Reaproveita pedido pendente do mesmo método com cobrança ainda válida.
  const pending = await findPendingOrder(supabase, user.id, course.id);
  if (pending) {
    const resolved = await resolvePending(pending, method, getService);
    if (resolved) redirect(resolved.reuse);
  }

  if (!isPaymentsConfigured()) {
    console.error('[checkout] payments env missing');
    throw new ActionError(providerError);
  }

  // 5. Novo pedido (service client; valores montados aqui).
  const { data: order, error: insertError } = await getService()
    .from('orders')
    .insert({
      user_id: user.id,
      course_id: course.id,
      amount_cents: course.priceCents,
      status: 'pending',
      source: 'checkout',
      provider: 'abacatepay',
      payment_method: method,
    })
    .select('id')
    .single();

  if (insertError || !order) {
    if (insertError?.code === '23505') {
      // Corrida no índice único de pending: outra requisição criou primeiro.
      const winner = await findPendingOrder(supabase, user.id, course.id);
      if (winner && isReusable(winner, method, Date.now())) redirect(reuseTarget(winner));
      throw new ActionError(IN_FLIGHT_ERROR);
    }
    logCheckoutError('insert order', null, insertError);
    throw new ActionError(GENERIC_ERROR);
  }

  // 6a. Cartão: checkout hospedado (dados do cartão nunca passam por nós).
  if (input.paymentMethod === 'card') {
    let checkout;
    try {
      checkout = await createCardCheckout({
        orderId: order.id,
        courseId: course.id,
        amountCents: course.priceCents,
        productName: course.title,
        maxInstallments: cardMaxInstallments(course.priceCents),
        returnUrl: orderPageUrl(order.id),
      });
    } catch (error) {
      logCheckoutError('create card checkout', order.id, error);
      await settlePending(getService(), order.id, 'failed').catch(() => undefined);
      throw new ActionError(CARD_PROVIDER_ERROR);
    }

    const { data: saved, error: saveError } = await getService()
      .from('orders')
      .update({
        provider_billing_id: checkout.billingId,
        checkout_url: checkout.url,
        expires_at: new Date(Date.now() + CARD_CHECKOUT_REUSE_SECONDS * 1000).toISOString(),
      })
      .eq('id', order.id)
      .eq('status', 'pending')
      .select('id');
    if (saveError || !saved || saved.length === 0) {
      logCheckoutError('save card checkout', order.id, saveError);
      await settlePending(getService(), order.id, 'failed').catch(() => undefined);
      throw new ActionError(GENERIC_ERROR);
    }

    // 7a. Para a página de pagamento da AbacatePay (URL já validada no cliente da API).
    redirect(checkout.url);
  }

  // 6b. Cobrança PIX no provedor.
  let charge;
  try {
    charge = await createPixCharge({
      orderId: order.id,
      amountCents: course.priceCents,
      description: `Curso: ${course.title}`,
      customer: {
        name: fullName.trim() || user.email,
        email: user.email,
        taxId: input.taxId,
        cellphone: input.phone,
      },
      expiresInSeconds: PIX_EXPIRES_IN_SECONDS,
      metadata: { courseId: course.id },
    });
  } catch (error) {
    logCheckoutError('create charge', order.id, error);
    await settlePending(getService(), order.id, 'failed').catch(() => undefined);
    throw new ActionError(PROVIDER_ERROR);
  }

  const expiresAt =
    charge.expiresAt ?? new Date(Date.now() + PIX_EXPIRES_IN_SECONDS * 1000).toISOString();
  const { data: saved, error: saveError } = await getService()
    .from('orders')
    .update({
      provider_billing_id: charge.billingId,
      pix_br_code: charge.brCode,
      pix_br_code_base64: charge.brCodeBase64,
      expires_at: expiresAt,
    })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('id');
  if (saveError || !saved || saved.length === 0) {
    logCheckoutError('save charge', order.id, saveError);
    await settlePending(getService(), order.id, 'failed').catch(() => undefined);
    throw new ActionError(GENERIC_ERROR);
  }

  // 7b. Página do pedido (QR em PAY-004).
  redirect(`/checkout/pedido/${order.id}`);
});

/** Intervalo mínimo entre reconsultas ao provedor por pedido (por instância; best-effort). */
const PROVIDER_CHECK_INTERVAL_MS = 10_000;
const lastProviderCheck = new Map<string, number>();

/**
 * Plano B ao webhook: se o pedido segue `pending`, reconsulta a AbacatePay pela
 * NOSSA chave e, só se ela disser `PAID` (e o valor bater, quando informado),
 * concede via `fulfill_order()` — a mesma função idempotente do webhook.
 * Falhas aqui nunca quebram o polling: o webhook continua sendo o caminho principal.
 */
async function reconcileWithProvider(order: {
  id: string;
  providerBillingId: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
}): Promise<void> {
  const now = Date.now();
  if (now - (lastProviderCheck.get(order.id) ?? 0) < PROVIDER_CHECK_INTERVAL_MS) return;
  lastProviderCheck.set(order.id, now);
  if (lastProviderCheck.size > 1000) lastProviderCheck.clear();

  try {
    const remote =
      order.paymentMethod === 'card'
        ? await getCardCheckoutStatus(order.providerBillingId)
        : await getPixStatus(order.providerBillingId);
    const verdict = providerVerdict(remote, order);
    if (verdict !== 'paid') {
      if (verdict === 'amount_mismatch' || verdict === 'billing_mismatch') {
        logCheckoutError(`reconcile ${verdict}`, order.id, null);
      }
      return;
    }
    const { error } = await createServiceClient().rpc('fulfill_order', {
      p_order_id: order.id,
      p_provider_billing_id: order.providerBillingId,
      p_amount_cents: order.amountCents,
    });
    if (error) logCheckoutError('reconcile fulfill', order.id, error);
  } catch (error) {
    logCheckoutError('reconcile check', order.id, error);
  }
}

/**
 * Polling da página do pedido: devolve status e validade, filtrando pelo `user_id`
 * da sessão (a RLS deixaria o admin ler pedidos de qualquer um). Enquanto
 * `pending`, reconsulta o provedor (ver `reconcileWithProvider`); o preço vem do banco.
 */
export const getOrderStatus = userAction(orderStatusInputSchema, async ({ orderId }, { user }) => {
  const supabase = await createClient();
  const read = () =>
    supabase
      .from('orders')
      .select('status, expires_at, provider_billing_id, amount_cents, payment_method')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

  let { data, error } = await read();
  if (!error && data?.status === 'pending' && data.provider_billing_id) {
    await reconcileWithProvider({
      id: orderId,
      providerBillingId: data.provider_billing_id,
      amountCents: data.amount_cents,
      paymentMethod: data.payment_method ?? 'pix',
    });
    ({ data, error } = await read());
  }
  if (error) {
    logCheckoutError('read order status', orderId, error);
    throw new ActionError(GENERIC_ERROR);
  }
  if (!data) throw new ActionError('Pedido não encontrado.');
  return { status: data.status, expiresAt: data.expires_at } satisfies OrderStatusSnapshot;
});
