import { z } from 'zod';

import { courseSlugSchema } from '@/features/catalog/schemas';
import { isValidCpf, normalizeBrPhone, onlyDigits } from '@/lib/payments/tax-id';

const taxIdSchema = z
  .string({ error: 'Informe o CPF.' })
  .trim()
  .min(1, 'Informe o CPF.')
  .max(20, 'CPF inválido.')
  .transform(onlyDigits)
  .refine(isValidCpf, 'CPF inválido. Confira os números.');

const phoneSchema = z
  .string({ error: 'Informe o celular.' })
  .trim()
  .min(1, 'Informe o celular.')
  .max(25, 'Telefone inválido.')
  .transform((value, ctx) => {
    const normalized = normalizeBrPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número.' });
      return z.NEVER;
    }
    return normalized;
  });

export const PAYMENT_METHODS = ['pix', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Input do checkout. Só identificadores, o método e dados pessoais do comprador:
 * preço, `user_id` e curso resolvido vêm SEMPRE do servidor (campos extras são ignorados).
 * - `pix` (padrão quando omitido): CPF + celular (vão na cobrança PIX);
 * - `card`: nada além do curso — o cartão e os dados do titular são digitados no
 *   checkout hospedado da AbacatePay (nunca passam por nós; ADR-022).
 */
export const startCheckoutSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null) return value;
    const method = (value as { paymentMethod?: unknown }).paymentMethod;
    return method === undefined || method === null || method === ''
      ? { ...value, paymentMethod: 'pix' }
      : value;
  },
  z.discriminatedUnion(
    'paymentMethod',
    [
      z.object({
        paymentMethod: z.literal('pix'),
        courseSlug: courseSlugSchema,
        taxId: taxIdSchema,
        phone: phoneSchema,
      }),
      z.object({ paymentMethod: z.literal('card'), courseSlug: courseSlugSchema }),
    ],
    { error: 'Escolha PIX ou cartão.' },
  ),
);

export type StartCheckoutInput = z.output<typeof startCheckoutSchema>;

/** Id do pedido na URL `/checkout/pedido/[orderId]`. */
export const orderIdSchema = z.uuid();

/** Input de `getOrderStatus` (polling da página do pedido). */
export const orderStatusInputSchema = z.object({ orderId: orderIdSchema });

/** Validade da cobrança PIX pedida ao provedor (docs/payments.md §2). */
export const PIX_EXPIRES_IN_SECONDS = 3600;

/** Pedido pendente só é reaproveitado se ainda tiver pelo menos isto de validade. */
export const REUSE_MIN_REMAINING_MS = 60_000;

/** Pedido pendente sem QR mais novo que isto é considerado "em andamento" (outra aba/clique). */
export const IN_FLIGHT_GRACE_MS = 2 * 60_000;

/** Pedido de cartão pendente reaproveita o mesmo checkout hospedado por este tempo (s). */
export const CARD_CHECKOUT_REUSE_SECONDS = 3600;

/** Parcelas oferecidas no cartão (ADR-022; taxa por conta da loja). */
export const CARD_MAX_INSTALLMENTS = 12;

/** Parcela mínima da AbacatePay: R$ 10,00 (docs/payments.md §10.2). */
export const CARD_MIN_INSTALLMENT_CENTS = 1000;

/** `min(CARD_MAX_INSTALLMENTS, floor(valor / R$ 10))`, nunca abaixo de 1. */
export function cardMaxInstallments(amountCents: number): number {
  const byMinimum = Math.floor(Math.max(0, amountCents) / CARD_MIN_INSTALLMENT_CENTS);
  return Math.max(1, Math.min(CARD_MAX_INSTALLMENTS, byMinimum));
}
