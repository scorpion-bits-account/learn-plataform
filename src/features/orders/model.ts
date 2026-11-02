import type { BadgeTone } from '@/components/ui';
import type { Database } from '@/types/database';

import type { OrderStatus } from './schemas';

export type OrderSource = Database['public']['Enums']['order_source'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];

export const REFUND_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  expired: 'Expirado',
  refunded: 'Reembolsado',
  canceled: 'Cancelado',
};

export const STATUS_TONES: Record<OrderStatus, BadgeTone> = {
  pending: 'amber',
  paid: 'mint',
  failed: 'coral',
  expired: 'neutral',
  refunded: 'violet',
  canceled: 'neutral',
};

export const SOURCE_LABELS: Record<OrderSource, string> = {
  checkout: 'Checkout',
  manual: 'Venda manual',
};

/** Como foi pago: PIX, cartão (checkout) ou venda manual. */
export function paymentMethodLabel(source: OrderSource, method: PaymentMethod | null): string {
  if (source === 'manual') return 'Venda manual';
  return method === 'card' ? 'Cartão de crédito' : 'PIX';
}

export type AdminOrderListItem = {
  id: string;
  status: OrderStatus;
  source: OrderSource;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
  createdAt: string;
  paidAt: string | null;
  refundRequestedAt: string | null;
  courseTitle: string;
  userId: string;
  studentName: string;
  studentEmail: string | null;
};

export type OrderEventView = {
  id: string;
  eventType: string;
  receivedAt: string;
  processedAt: string | null;
  processingError: string | null;
};

export type AdminOrderDetail = {
  id: string;
  status: OrderStatus;
  source: OrderSource;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
  providerBillingId: string | null;
  courseId: string;
  courseTitle: string;
  userId: string;
  studentName: string;
  studentEmail: string | null;
  /** % de aulas concluídas hoje (0-100). */
  progressPercent: number;
  /** % gravado no pedido de reembolso do aluno (pode diferir do atual). */
  refundRequestedProgress: number | null;
  events: OrderEventView[];
};

export type MyOrder = {
  id: string;
  courseTitle: string;
  status: OrderStatus;
  source: OrderSource;
  amountCents: number;
  createdAt: string;
  paidAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
};

// ---------------------------------------------------------------------------
// Regras de exibição (a regra de verdade mora no banco: `request_refund`)
// ---------------------------------------------------------------------------

/** Pedido que a reconsulta pode tentar liberar. */
export function canRecheck(o: { status: OrderStatus; providerBillingId: string | null }): boolean {
  return o.providerBillingId !== null && ['pending', 'expired', 'failed'].includes(o.status);
}

/** Admin pode reembolsar qualquer pedido pago com cobrança na AbacatePay — PIX ou cartão (mesmo após os 7 dias). */
export function canRefund(o: {
  status: OrderStatus;
  source: OrderSource;
  providerBillingId: string | null;
}): boolean {
  return o.status === 'paid' && o.source === 'checkout' && o.providerBillingId !== null;
}

/** Milissegundos restantes da janela do aluno; negativo = expirada; `null` sem `paid_at`. */
export function refundWindowRemainingMs(paidAt: string | null, now: number): number | null {
  if (!paidAt) return null;
  return Date.parse(paidAt) + REFUND_WINDOW_DAYS * DAY_MS - now;
}

/** "6 dias", "5 horas", "menos de 1 hora" a partir de ms restantes (> 0). */
export function formatRemaining(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return days === 1 ? '1 dia' : `${days} dias`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return hours === 1 ? '1 hora' : `${hours} horas`;
  return 'menos de 1 hora';
}

export type MyOrderRefundState =
  | { kind: 'eligible'; remaining: string }
  | { kind: 'requested' }
  | { kind: 'refunded' }
  | { kind: 'window_expired' }
  | { kind: 'none' };

export function myOrderRefundState(o: MyOrder, now: number): MyOrderRefundState {
  if (o.status === 'refunded') return { kind: 'refunded' };
  if (o.status !== 'paid' || o.source !== 'checkout') return { kind: 'none' };
  if (o.refundRequestedAt) return { kind: 'requested' };
  const remaining = refundWindowRemainingMs(o.paidAt, now);
  if (remaining === null) return { kind: 'none' };
  if (remaining <= 0) return { kind: 'window_expired' };
  return { kind: 'eligible', remaining: formatRemaining(remaining) };
}

// ---------------------------------------------------------------------------
// Tradução de códigos
// ---------------------------------------------------------------------------

export const REQUEST_REFUND_MESSAGES: Record<string, string> = {
  already_requested: 'Você já pediu o reembolso deste pedido. Aguarde o retorno da equipe.',
  already_refunded: 'Este pedido já foi reembolsado.',
  not_found: 'Pedido não encontrado.',
  not_paid: 'Só é possível pedir reembolso de pedidos pagos.',
  not_eligible: 'Este pedido não é elegível ao reembolso pelo site. Fale com o suporte.',
  window_expired: 'O prazo de 7 dias para pedir reembolso já passou.',
  previously_refunded:
    'Você já teve um reembolso (ou pedido) para este curso, então não é possível pedir de novo.',
};

export const FULFILL_MESSAGES: Record<string, string> = {
  fulfilled: 'Pagamento confirmado: acesso liberado ao aluno.',
  paid_already_enrolled:
    'Pagamento confirmado, mas o aluno já tinha acesso ao curso (pagamento em duplicidade: considere reembolsar).',
  already_paid: 'O pedido já constava como pago.',
  order_not_found: 'Pedido não encontrado.',
  invalid_status: 'O pedido está em um estado que não aceita pagamento (cancelado ou reembolsado).',
  amount_mismatch: 'O valor pago na AbacatePay diverge do valor do pedido. Nada foi liberado.',
  billing_mismatch: 'A cobrança consultada não é a do pedido. Nada foi liberado.',
};

/** Resultado de `fulfill_order` que representa acesso concedido ou já concedido. */
export const FULFILL_OK = new Set(['fulfilled', 'paid_already_enrolled', 'already_paid']);

const EVENT_TYPE_LABELS: Record<string, string> = {
  'transparent.completed': 'Pagamento confirmado',
  'transparent.refunded': 'Reembolso confirmado',
  'transparent.disputed': 'Disputa aberta',
  'transparent.lost': 'Disputa perdida',
  'checkout.completed': 'Pagamento confirmado',
  'checkout.refunded': 'Reembolso confirmado',
};

export const eventTypeLabel = (type: string) => EVENT_TYPE_LABELS[type] ?? type;

const PROCESSING_ERRORS: Record<string, string> = {
  order_not_found: 'Pedido não encontrado',
  billing_mismatch: 'Cobrança diferente da do pedido',
  amount_mismatch: 'Valor diferente do pedido',
  invalid_status: 'Estado do pedido não aceita o evento',
  provider_check_rejected: 'Consulta ao provedor recusada',
  unsupported_event: 'Evento não suportado',
};

/** Resultado legível do evento, sem payload: processado, pendente ou erro traduzido. */
export function eventResult(e: OrderEventView): {
  label: string;
  tone: 'ok' | 'pending' | 'error';
} {
  if (e.processingError) {
    const code = e.processingError.replace(/^[a-z_]+:\s*/, '');
    const text =
      PROCESSING_ERRORS[code] ??
      (code.startsWith('provider_status_')
        ? 'Provedor não confirmou o pagamento'
        : 'Erro de processamento');
    return { label: text, tone: 'error' };
  }
  if (e.processedAt) return { label: 'Processado', tone: 'ok' };
  return { label: 'Aguardando processamento', tone: 'pending' };
}
