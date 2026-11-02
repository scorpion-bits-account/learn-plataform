import { createHmac } from 'node:crypto';

import { expect } from '@playwright/test';

import { loadE2eEnv } from './env';
import { getOrder } from './service';

/**
 * Chave PÚBLICA de assinatura dos webhooks da AbacatePay (a mesma de
 * `src/lib/payments/abacatepay-webhook.ts`, que é `server-only` e não pode ser importada
 * aqui). Não é segredo: https://docs.abacatepay.com/pages/webhooks/security
 */
const PUBLIC_HMAC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export function signBody(rawBody: string): string {
  return createHmac('sha256', PUBLIC_HMAC_KEY).update(rawBody, 'utf8').digest('base64');
}

/** `provider_billing_id` gravado no pedido pelo app (espera o app falar com o mock). */
export async function billingIdOf(orderId: string): Promise<string> {
  let billing: string | null = null;
  await expect
    .poll(
      async () => {
        billing = (await getOrder(orderId)).provider_billing_id as string | null;
        return billing;
      },
      { message: 'pedido com cobrança gravada (app → mock da AbacatePay)' },
    )
    .toBeTruthy();
  return billing!;
}

/** "Pagar o PIX" no Dev mode: o mock marca a cobrança como `PAID`. */
export async function simulatePayment(billingId: string): Promise<void> {
  const env = loadE2eEnv();
  const res = await fetch(
    `${env.mockBaseUrl}/transparents/simulate-payment?id=${encodeURIComponent(billingId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  expect(res.status, 'simulate-payment no mock').toBe(200);
}

/** Entrega `transparent.completed` ao webhook REAL do app (com segredo na URL e HMAC). */
export async function sendCompletedWebhook(orderId: string, billingId: string) {
  const env = loadE2eEnv();
  const order = await getOrder(orderId);
  const amount = order.amount_cents as number;
  const raw = JSON.stringify({
    id: `log_e2e_${orderId}`,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: true,
    data: {
      transparent: {
        id: billingId,
        externalId: orderId,
        amount,
        paidAmount: amount,
        platformFee: 80,
        status: 'PAID',
        methods: ['PIX'],
      },
    },
  });
  return postWebhook(raw, { secret: env.webhookSecret });
}

export async function postWebhook(
  raw: string,
  options: { secret: string | null; signature?: string },
): Promise<{ status: number; body: { ok: boolean; result: string } }> {
  const env = loadE2eEnv();
  const url = new URL('/api/webhooks/abacatepay', env.siteUrl);
  if (options.secret !== null) url.searchParams.set('webhookSecret', options.secret);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': options.signature ?? signBody(raw),
    },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result: string } };
}

/**
 * "Pagar com cartão" no checkout hospedado do mock (PAY-007), sem o navegador:
 * o mesmo POST que o botão da página `/pay/<bill_…>` faz.
 */
export async function payCardCheckout(billingId: string): Promise<void> {
  const env = loadE2eEnv();
  const origin = new URL(env.mockBaseUrl).origin;
  const res = await fetch(`${origin}/pay/${encodeURIComponent(billingId)}`, {
    method: 'POST',
    redirect: 'manual',
  });
  expect(res.status, 'pagamento no checkout do mock').toBe(303);
}

/** Entrega `checkout.<evento>` (cartão) ao webhook REAL do app (segredo na URL + HMAC). */
export async function sendCheckoutWebhook(
  orderId: string,
  billingId: string,
  event: 'checkout.completed' | 'checkout.refunded' = 'checkout.completed',
) {
  const env = loadE2eEnv();
  const order = await getOrder(orderId);
  const amount = order.amount_cents as number;
  const raw = JSON.stringify({
    id: `log_e2e_${event}_${orderId}`,
    event,
    apiVersion: 2,
    devMode: true,
    data: {
      checkout: {
        id: billingId,
        externalId: orderId,
        amount,
        paidAmount: amount,
        platformFee: 602,
        frequency: 'ONE_TIME',
        status: 'PAID',
        methods: ['CARD'],
        installmentsCount: null,
      },
      payerInformation: { method: 'CARD', CARD: { number: '4242', brand: 'VISA' } },
    },
  });
  return postWebhook(raw, { secret: env.webhookSecret });
}
