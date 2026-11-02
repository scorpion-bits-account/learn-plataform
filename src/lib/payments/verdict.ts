/**
 * Decisão única sobre a RECONSULTA ao provedor (PIX `transparents/check` ou cartão
 * `checkouts/get`) antes de chamar `fulfill_order` — usada pelo webhook, pelo polling
 * do aluno e pela reconsulta do admin. Pura (sem I/O).
 *
 * Só `paid` libera. Valores informados pelo provedor precisam bater com o pedido
 * (`amount` e, no cartão, `paidAmount` e `externalId`).
 */
export type ProviderVerdict =
  'paid' | 'pending' | 'amount_mismatch' | 'billing_mismatch' | 'not_paid';

export interface RemoteChargeState {
  status: string;
  amountCents: number | null;
  paidAmountCents?: number | null;
  externalId?: string | null;
}

export function providerVerdict(
  remote: RemoteChargeState,
  order: { id: string; amountCents: number },
): ProviderVerdict {
  if (remote.externalId != null && remote.externalId !== order.id) return 'billing_mismatch';
  if (remote.status === 'PENDING') return 'pending';
  if (remote.status !== 'PAID') return 'not_paid';
  if (remote.amountCents !== null && remote.amountCents !== order.amountCents) {
    return 'amount_mismatch';
  }
  if (remote.paidAmountCents != null && remote.paidAmountCents !== order.amountCents) {
    return 'amount_mismatch';
  }
  return 'paid';
}
