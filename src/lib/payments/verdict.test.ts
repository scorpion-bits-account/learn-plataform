import { describe, expect, it } from 'vitest';

import { providerVerdict } from './verdict';

const order = { id: 'o1', amountCents: 4990 };

describe('providerVerdict', () => {
  it('só PAID com valores iguais libera', () => {
    expect(providerVerdict({ status: 'PAID', amountCents: 4990 }, order)).toBe('paid');
    expect(providerVerdict({ status: 'PAID', amountCents: null }, order)).toBe('paid');
    expect(
      providerVerdict(
        { status: 'PAID', amountCents: 4990, paidAmountCents: 4990, externalId: 'o1' },
        order,
      ),
    ).toBe('paid');
  });

  it('PENDING é transitório; outros status não pagam', () => {
    expect(providerVerdict({ status: 'PENDING', amountCents: 4990 }, order)).toBe('pending');
    for (const status of ['EXPIRED', 'CANCELLED', 'REFUNDED', 'REDEEMED', 'APPROVED', 'UNKNOWN']) {
      expect(providerVerdict({ status, amountCents: 4990 }, order)).toBe('not_paid');
    }
  });

  it('valor ou valor pago divergente não libera (ex.: cupom no checkout)', () => {
    expect(providerVerdict({ status: 'PAID', amountCents: 100 }, order)).toBe('amount_mismatch');
    expect(providerVerdict({ status: 'PAID', amountCents: 4990, paidAmountCents: 0 }, order)).toBe(
      'amount_mismatch',
    );
  });

  it('checkout de outro pedido não libera', () => {
    expect(providerVerdict({ status: 'PAID', amountCents: 4990, externalId: 'o2' }, order)).toBe(
      'billing_mismatch',
    );
  });
});
