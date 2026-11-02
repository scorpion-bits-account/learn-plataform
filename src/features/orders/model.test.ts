import { describe, expect, it } from 'vitest';

import {
  canRecheck,
  canRefund,
  eventResult,
  formatRemaining,
  myOrderRefundState,
  paymentMethodLabel,
  refundWindowRemainingMs,
} from './model';
import type { MyOrder } from './model';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const DAY = 86_400_000;
const order = (over: Partial<MyOrder>): MyOrder => ({
  id: 'o',
  courseTitle: 'C',
  status: 'paid',
  source: 'checkout',
  amountCents: 100,
  createdAt: '',
  paidAt: new Date(NOW - 2 * DAY).toISOString(),
  refundRequestedAt: null,
  refundedAt: null,
  ...over,
});

describe('janela de reembolso', () => {
  it('7 dias a partir de paid_at', () => {
    expect(refundWindowRemainingMs(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(5 * DAY);
    expect(refundWindowRemainingMs(null, NOW)).toBeNull();
  });
  it('formata o restante', () => {
    expect(formatRemaining(5 * DAY + 3600_000)).toBe('5 dias');
    expect(formatRemaining(DAY)).toBe('1 dia');
    expect(formatRemaining(5 * 3600_000)).toBe('5 horas');
    expect(formatRemaining(60_000)).toBe('menos de 1 hora');
  });
  it('estado por pedido', () => {
    expect(myOrderRefundState(order({}), NOW)).toEqual({ kind: 'eligible', remaining: '5 dias' });
    expect(
      myOrderRefundState(order({ paidAt: new Date(NOW - 8 * DAY).toISOString() }), NOW).kind,
    ).toBe('window_expired');
    expect(myOrderRefundState(order({ refundRequestedAt: 'x' }), NOW).kind).toBe('requested');
    expect(myOrderRefundState(order({ status: 'refunded' }), NOW).kind).toBe('refunded');
    expect(myOrderRefundState(order({ source: 'manual' }), NOW).kind).toBe('none');
  });
});

describe('elegibilidade admin', () => {
  it('reconsulta: pending/expired/failed com cobrança', () => {
    for (const status of ['pending', 'expired', 'failed'] as const) {
      expect(canRecheck({ status, providerBillingId: 'p' })).toBe(true);
      expect(canRecheck({ status, providerBillingId: null })).toBe(false);
    }
    expect(canRecheck({ status: 'paid', providerBillingId: 'p' })).toBe(false);
  });
  it('reembolso: pago do checkout com cobrança', () => {
    expect(canRefund({ status: 'paid', source: 'checkout', providerBillingId: 'p' })).toBe(true);
    expect(canRefund({ status: 'paid', source: 'manual', providerBillingId: null })).toBe(false);
    expect(canRefund({ status: 'refunded', source: 'checkout', providerBillingId: 'p' })).toBe(
      false,
    );
  });
});

describe('eventResult', () => {
  const base = {
    id: '1',
    eventType: 't',
    receivedAt: '',
    processedAt: null,
    processingError: null,
  };
  it('processado, pendente e erro (sem expor texto bruto)', () => {
    expect(eventResult({ ...base, processedAt: 'x' }).tone).toBe('ok');
    expect(eventResult(base).tone).toBe('pending');
    const e = eventResult({ ...base, processingError: 'fulfill_order: amount_mismatch' });
    expect(e).toEqual({ label: 'Valor diferente do pedido', tone: 'error' });
    expect(eventResult({ ...base, processingError: 'algo qualquer com cpf 123' }).label).toBe(
      'Erro de processamento',
    );
  });
});

describe('paymentMethodLabel', () => {
  it('PIX, cartão ou venda manual', () => {
    expect(paymentMethodLabel('checkout', 'pix')).toBe('PIX');
    expect(paymentMethodLabel('checkout', null)).toBe('PIX');
    expect(paymentMethodLabel('checkout', 'card')).toBe('Cartão de crédito');
    expect(paymentMethodLabel('manual', null)).toBe('Venda manual');
  });
});
