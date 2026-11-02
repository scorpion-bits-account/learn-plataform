import { z } from 'zod';

/**
 * URL base da API da AbacatePay. Padrão = a real. `ABACATEPAY_API_BASE_URL` existe só
 * para apontar o app para o mock dos testes E2E (`e2e/mocks/abacatepay.ts`, ADR-021).
 *
 * Validada com zod: só `https://…` ou `http://localhost|127.0.0.1` (nunca um HTTP
 * qualquer, para uma env errada não mandar a chave da API em texto puro pela rede).
 * Módulo puro (sem `server-only`/env) para ser testável.
 */
export const DEFAULT_ABACATEPAY_API_BASE_URL = 'https://api.abacatepay.com/v2';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export const abacatePayBaseUrlSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  }, 'ABACATEPAY_API_BASE_URL deve ser https://… ou http://localhost|127.0.0.1');

/** Valor vazio/ausente = padrão. Valor inválido lança `ZodError` (quem chama traduz). */
export function resolveAbacatePayBaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ABACATEPAY_API_BASE_URL;
  return abacatePayBaseUrlSchema.parse(raw);
}

/** Host do checkout hospedado da AbacatePay (`https://app.abacatepay.com/pay/bill_…`). */
export const ABACATEPAY_CHECKOUT_HOST = 'app.abacatepay.com';

/**
 * `true` se `value` é uma URL de checkout hospedado em que podemos fazer `redirect`
 * (PAY-007): `https://app.abacatepay.com/pay/…`. Só quando a API aponta para o mock
 * dos testes E2E (base diferente da real; nunca com chave de produção, ver `abacatepay.ts`),
 * aceita também a mesma origem do mock. Sem credenciais, query de terceiros ou outro host.
 */
export function isAbacatePayCheckoutUrl(value: string, apiBaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || !url.pathname.startsWith('/pay/')) return false;
  if (url.protocol === 'https:' && url.hostname === ABACATEPAY_CHECKOUT_HOST && !url.port) {
    return true;
  }
  if (apiBaseUrl === DEFAULT_ABACATEPAY_API_BASE_URL) return false;
  try {
    return url.origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}
