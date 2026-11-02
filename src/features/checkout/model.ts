import type { Database } from '@/types/database';

/** Tipos e funções puras do checkout (sem I/O; seguros no cliente). */

export type OrderStatus = Database['public']['Enums']['order_status'];
export type OrderPaymentMethod = Database['public']['Enums']['payment_method'];

export const PAYMENT_METHOD_LABEL: Record<OrderPaymentMethod, string> = {
  pix: 'PIX',
  card: 'Cartão de crédito',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Aguardando pagamento',
  paid: 'Pago',
  failed: 'Falhou',
  expired: 'Expirado',
  refunded: 'Reembolsado',
  canceled: 'Cancelado',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, 'amber' | 'mint' | 'coral' | 'neutral'> = {
  pending: 'amber',
  paid: 'mint',
  failed: 'coral',
  expired: 'neutral',
  refunded: 'neutral',
  canceled: 'neutral',
};

/** Prazo legal de arrependimento (CDC art. 49; ADR-017). */
export const REFUND_WINDOW_DAYS = 7;

/** Estado do formulário de checkout (`useActionState`). */
export type CheckoutFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[] | undefined> }
  | { status: 'owned'; href: string };

export const CHECKOUT_IDLE: CheckoutFormState = { status: 'idle' };

/** Pedido do próprio aluno (`/checkout/pedido/[id]`). */
export type MyOrder = {
  id: string;
  status: OrderStatus;
  amountCents: number;
  expiresAt: string | null;
  createdAt: string;
  hasPix: boolean;
  /** `pix` ou `card` (pedido de checkout). */
  paymentMethod: OrderPaymentMethod;
  /** Checkout hospedado do cartão (validado). Só vem preenchido enquanto `pending`. */
  checkoutUrl: string | null;
  /** Copia-e-cola PIX. Só vem preenchido enquanto o pedido está `pending`. */
  pixBrCode: string | null;
  /** Data URL de imagem do QR (validada em `toQrSrc`). Só em `pending`. */
  pixQrSrc: string | null;
  course: { slug: string | null; title: string };
};

/** Dados da página `/checkout/[slug]`. */
export type CheckoutPrefill = { taxId: string; phone: string };

/** Só aceita data URL de imagem raster/svg em base64 (vai para `<img src>`). */
export function toQrSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

/** Retorno de `getOrderStatus` (só o necessário para o polling). */
export type OrderStatusSnapshot = { status: OrderStatus; expiresAt: string | null };

export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'paid',
  'failed',
  'expired',
  'refunded',
  'canceled',
];

export function isFinalStatus(status: OrderStatus): boolean {
  return status !== 'pending';
}

/** Polling: começa em 3 s e sobe 0,5 s por tentativa até 5 s. */
export const POLL_MIN_MS = 3000;
export const POLL_MAX_MS = 5000;
export const POLL_STEP_MS = 500;
/** Para de consultar depois de ~10 min (o aluno ainda pode "Verificar agora"). */
export const POLL_MAX_DURATION_MS = 10 * 60_000;

export function nextPollDelay(attempt: number): number {
  return Math.min(POLL_MAX_MS, POLL_MIN_MS + Math.max(0, attempt) * POLL_STEP_MS);
}

/** mm:ss (minutos podem passar de 59; nunca negativo). */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Texto para o leitor de tela, atualizado só a cada minuto. */
export function countdownAnnouncement(remainingMs: number): string {
  const minutes = Math.ceil(Math.max(0, remainingMs) / 60_000);
  if (minutes <= 0) return 'O PIX expirou.';
  return minutes === 1
    ? 'Falta cerca de 1 minuto para o PIX expirar.'
    : `Faltam cerca de ${minutes} minutos para o PIX expirar.`;
}
