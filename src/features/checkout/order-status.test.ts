import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const requireUser = vi.fn();
vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser(), requireAdmin: vi.fn() }));
vi.mock('@/features/catalog/queries', () => ({ getPublishedCourse: vi.fn() }));
const getPixStatus = vi.fn();
const getCardCheckoutStatus = vi.fn();
vi.mock('@/lib/payments/abacatepay', () => ({
  getPixStatus: (id: string) => getPixStatus(id),
  getCardCheckoutStatus: (id: string) => getCardCheckoutStatus(id),
  createCardCheckout: vi.fn(),
  createPixCharge: vi.fn(),
  isPaymentsConfigured: vi.fn(),
  PaymentProviderError: class extends Error {},
}));
const rpc = vi.fn();
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc }) }));

const eqs: [string, unknown][] = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };
/** Leituras seguintes (após a reconsulta); vazio = repete `result`. */
const nextResults: { data: unknown; error: unknown }[] = [];
const builder: Record<string, unknown> = {};
builder.select = () => builder;
builder.eq = (col: string, val: unknown) => {
  eqs.push([col, val]);
  return builder;
};
builder.maybeSingle = () => {
  const current = result;
  result = nextResults.shift() ?? result;
  return Promise.resolve(current);
};
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: () => builder })),
}));

import { getOrderStatus } from './actions';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'ana@exemplo.com' };
const ORDER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  eqs.length = 0;
  result = { data: null, error: null };
  nextResults.length = 0;
  getPixStatus.mockReset();
  getCardCheckoutStatus.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 'fulfilled', error: null });
  requireUser.mockReset();
  requireUser.mockResolvedValue(USER);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('getOrderStatus', () => {
  it('rejeita anônimo antes de ler qualquer coisa', async () => {
    requireUser.mockRejectedValue(new Error('NEXT_REDIRECT /entrar'));
    await expect(getOrderStatus({ orderId: ORDER })).rejects.toThrow('NEXT_REDIRECT');
    expect(eqs).toEqual([]);
  });

  it('filtra pelo id do pedido e pelo user_id da sessão e devolve só status/validade', async () => {
    result = {
      data: { status: 'paid', expires_at: '2026-10-08T21:00:00.000Z', pix_br_code: 'segredo' },
      error: null,
    };
    const res = await getOrderStatus({ orderId: ORDER });
    expect(eqs).toEqual([
      ['id', ORDER],
      ['user_id', USER.id],
    ]);
    expect(res).toEqual({
      ok: true,
      data: { status: 'paid', expiresAt: '2026-10-08T21:00:00.000Z' },
    });
  });

  it('pedido de outro usuário (sem linha) não revela existência', async () => {
    const res = await getOrderStatus({ orderId: ORDER });
    expect(res).toMatchObject({ ok: false, error: 'Pedido não encontrado.' });
  });

  it('rejeita id inválido e ignora user_id vindo do input', async () => {
    expect(await getOrderStatus({ orderId: 'nao-e-uuid' })).toMatchObject({ ok: false });
    await getOrderStatus({ orderId: ORDER, userId: 'outro' });
    expect(eqs).not.toContainEqual(['user_id', 'outro']);
  });

  it('erro do banco vira mensagem genérica', async () => {
    result = { data: null, error: { code: 'XX000' } };
    expect(await getOrderStatus({ orderId: ORDER })).toMatchObject({ ok: false });
  });
});

describe('getOrderStatus — reconsulta ao provedor (plano B ao webhook)', () => {
  let n = 0;
  const freshOrder = () => `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`;
  const pending = {
    status: 'pending',
    expires_at: null,
    provider_billing_id: 'pix_char_x',
    amount_cents: 1000,
  };

  it('PAID: concede via fulfill_order com valor do banco e devolve o status relido', async () => {
    const id = freshOrder();
    result = { data: pending, error: null };
    nextResults.push({ data: { ...pending, status: 'paid' }, error: null });
    getPixStatus.mockResolvedValue({ status: 'PAID', amountCents: null });
    const res = await getOrderStatus({ orderId: id });
    expect(getPixStatus).toHaveBeenCalledWith('pix_char_x');
    expect(rpc).toHaveBeenCalledWith('fulfill_order', {
      p_order_id: id,
      p_provider_billing_id: 'pix_char_x',
      p_amount_cents: 1000,
    });
    expect(res).toMatchObject({ ok: true, data: { status: 'paid' } });
  });

  it.each(['PENDING', 'EXPIRED', 'CANCELLED', 'REFUNDED'])('%s: não concede', async (status) => {
    result = { data: pending, error: null };
    getPixStatus.mockResolvedValue({ status, amountCents: null });
    await getOrderStatus({ orderId: freshOrder() });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('valor informado pelo provedor diferente do pedido: não concede', async () => {
    result = { data: pending, error: null };
    getPixStatus.mockResolvedValue({ status: 'PAID', amountCents: 1 });
    await getOrderStatus({ orderId: freshOrder() });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('falha do provedor não quebra o polling', async () => {
    result = { data: pending, error: null };
    getPixStatus.mockRejectedValue(new Error('timeout'));
    expect(await getOrderStatus({ orderId: freshOrder() })).toMatchObject({
      ok: true,
      data: { status: 'pending' },
    });
  });

  it('limita a reconsulta a uma a cada 10 s por pedido', async () => {
    const id = freshOrder();
    result = { data: pending, error: null };
    getPixStatus.mockResolvedValue({ status: 'PENDING', amountCents: null });
    await getOrderStatus({ orderId: id });
    await getOrderStatus({ orderId: id });
    expect(getPixStatus).toHaveBeenCalledTimes(1);
  });

  it('pedido sem cobrança ou já pago não consulta o provedor', async () => {
    result = { data: { ...pending, provider_billing_id: null }, error: null };
    await getOrderStatus({ orderId: freshOrder() });
    result = { data: { ...pending, status: 'paid' }, error: null };
    await getOrderStatus({ orderId: freshOrder() });
    expect(getPixStatus).not.toHaveBeenCalled();
  });

  describe('cartão', () => {
    const card = { ...pending, provider_billing_id: 'bill_x', payment_method: 'card' };

    it('PAID com valores e pedido iguais: reconsulta checkouts/get e concede', async () => {
      const id = freshOrder();
      result = { data: card, error: null };
      getCardCheckoutStatus.mockResolvedValue({
        status: 'PAID',
        amountCents: 1000,
        paidAmountCents: 1000,
        externalId: id,
      });
      await getOrderStatus({ orderId: id });
      expect(getCardCheckoutStatus).toHaveBeenCalledWith('bill_x');
      expect(getPixStatus).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith('fulfill_order', {
        p_order_id: id,
        p_provider_billing_id: 'bill_x',
        p_amount_cents: 1000,
      });
    });

    it.each([
      ['paidAmount diferente', { paidAmountCents: 500 }],
      ['checkout de outro pedido', { externalId: 'outro' }],
      ['não pago', { status: 'REDEEMED' }],
    ])('%s: não concede', async (_name, over) => {
      const id = freshOrder();
      result = { data: card, error: null };
      getCardCheckoutStatus.mockResolvedValue({
        status: 'PAID',
        amountCents: 1000,
        paidAmountCents: 1000,
        externalId: id,
        ...over,
      });
      await getOrderStatus({ orderId: id });
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
