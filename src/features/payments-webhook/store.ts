import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import type { Database, Json } from '@/types/database';

/**
 * Acesso ao banco do webhook (service role — bypassa RLS). Só lê/escreve
 * `payment_events` e lê `orders`; o pedido só muda via `fulfill_order` /
 * `refund_order` (security definer, transação atômica e idempotente).
 *
 * Qualquer erro do banco vira `WebhookTransientError` → 5xx → a AbacatePay re-tenta.
 */

export class WebhookTransientError extends Error {
  constructor(
    step: string,
    readonly code?: string,
  ) {
    super(`Falha transitória no webhook (${step}).`);
    this.name = 'WebhookTransientError';
  }
}

export type OrderStatus = Database['public']['Enums']['order_status'];

export interface WebhookOrder {
  id: string;
  status: OrderStatus;
  provider: string;
  providerBillingId: string | null;
  amountCents: number;
  /** `pix` | `card` (nulo só em venda manual). */
  paymentMethod: Database['public']['Enums']['payment_method'] | null;
}

/**
 * - `new`: primeira entrega, seguir processando;
 * - `retry`: o evento já existe mas não terminou (falha transitória anterior): reprocessar;
 * - `duplicate`: já processado ou com erro de dado registrado: nada a fazer.
 */
export type RecordEventResult = 'new' | 'retry' | 'duplicate';

export interface MarkEventInput {
  orderId: string | null;
  processed: boolean;
  error: string | null;
}

export interface FulfillOrderInput {
  orderId: string;
  billingId: string;
  /** Valor informado pelo provedor (centavos); `fulfill_order` compara com o pedido. */
  amountCents: number;
  eventId: string;
}

export interface WebhookStore {
  recordEvent(input: {
    providerEventId: string;
    eventType: string;
    payload: Json;
  }): Promise<RecordEventResult>;
  findOrder(orderId: string): Promise<WebhookOrder | null>;
  /** `true` se outra cobrança/pedido já usa este billing id (evita "sequestrar" um pedido). */
  isBillingUsedByAnotherOrder(billingId: string, orderId: string): Promise<boolean>;
  markEvent(providerEventId: string, input: MarkEventInput): Promise<void>;
  fulfillOrder(input: FulfillOrderInput): Promise<string>;
  refundOrder(orderId: string, eventId: string): Promise<string>;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

const UNIQUE_VIOLATION = '23505';

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function createWebhookStore(client: ServiceClient = createServiceClient()): WebhookStore {
  return {
    async recordEvent({ providerEventId, eventType, payload }) {
      const { error } = await client.from('payment_events').insert({
        provider: 'abacatepay',
        provider_event_id: providerEventId,
        event_type: eventType,
        payload,
      });
      if (!error) return 'new';
      if (codeOf(error) !== UNIQUE_VIOLATION) {
        throw new WebhookTransientError('insert event', codeOf(error));
      }

      const { data, error: readError } = await client
        .from('payment_events')
        .select('processed_at, processing_error')
        .eq('provider_event_id', providerEventId)
        .maybeSingle();
      if (readError || !data) throw new WebhookTransientError('read event', codeOf(readError));
      return data.processed_at !== null || data.processing_error !== null ? 'duplicate' : 'retry';
    },

    async findOrder(orderId) {
      const { data, error } = await client
        .from('orders')
        .select('id, status, provider, provider_billing_id, amount_cents, payment_method')
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw new WebhookTransientError('read order', codeOf(error));
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        provider: data.provider,
        providerBillingId: data.provider_billing_id,
        amountCents: data.amount_cents,
        paymentMethod: data.payment_method,
      };
    },

    async isBillingUsedByAnotherOrder(billingId, orderId) {
      const { data, error } = await client
        .from('orders')
        .select('id')
        .eq('provider_billing_id', billingId)
        .neq('id', orderId)
        .limit(1);
      if (error) throw new WebhookTransientError('read billing', codeOf(error));
      return (data ?? []).length > 0;
    },

    async markEvent(providerEventId, { orderId, processed, error: processingError }) {
      const { error } = await client
        .from('payment_events')
        .update({
          ...(orderId ? { order_id: orderId } : {}),
          processed_at: processed ? new Date().toISOString() : null,
          processing_error: processingError,
        })
        .eq('provider_event_id', providerEventId);
      if (error) throw new WebhookTransientError('update event', codeOf(error));
    },

    async fulfillOrder({ orderId, billingId, amountCents, eventId }) {
      const { data, error } = await client.rpc('fulfill_order', {
        p_order_id: orderId,
        p_provider_billing_id: billingId,
        p_amount_cents: amountCents,
        p_event_id: eventId,
      });
      if (error || typeof data !== 'string') {
        throw new WebhookTransientError('fulfill_order', codeOf(error));
      }
      return data;
    },

    async refundOrder(orderId, eventId) {
      const { data, error } = await client.rpc('refund_order', {
        p_order_id: orderId,
        p_event_id: eventId,
      });
      if (error || typeof data !== 'string') {
        throw new WebhookTransientError('refund_order', codeOf(error));
      }
      return data;
    },
  };
}
