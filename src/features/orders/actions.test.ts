import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

class NotFoundError extends Error {}
const requireAdmin = vi.fn();
const requireUser = vi.fn();
vi.mock('@/lib/auth/dal', () => ({
  requireAdmin: () => requireAdmin(),
  requireUser: () => requireUser(),
}));

// Provedor (a classe de erro é a real; só as chamadas HTTP são mockadas)
const getPixStatus = vi.fn();
const refundPixCharge = vi.fn();
const getCardCheckoutStatus = vi.fn();
const refundCardCheckout = vi.fn();
vi.mock('@/lib/payments/abacatepay', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/payments/abacatepay')>()),
  getPixStatus: (...a: unknown[]) => getPixStatus(...a),
  refundPixCharge: (...a: unknown[]) => refundPixCharge(...a),
  getCardCheckoutStatus: (...a: unknown[]) => getCardCheckoutStatus(...a),
  refundCardCheckout: (...a: unknown[]) => refundCardCheckout(...a),
}));
import { PaymentProviderError } from '@/lib/payments/abacatepay';

// Service role (único ponto de concessão)
const fulfillOrderAsService = vi.fn();
vi.mock('./service', () => ({
  fulfillOrderAsService: (...a: unknown[]) => fulfillOrderAsService(...a),
}));

// Client do usuário
let orderRow: Record<string, unknown> | null;
const rpcCalls: { fn: string; args: unknown }[] = [];
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};
const writes: string[] = [];
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const op of ['select', 'eq']) b[op] = () => b;
  for (const op of ['insert', 'update', 'delete', 'upsert']) {
    b[op] = () => {
      writes.push(`${table}.${op}`);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve({ data: orderRow, error: null });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResults[fn] ?? { data: null, error: null };
    },
  })),
}));

import { executeRefund, recheckPayment, recordManualSale, requestRefund } from './actions';

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COURSE = '33333333-3333-4333-8333-333333333333';

const pending = {
  id: ORDER,
  status: 'pending',
  source: 'checkout',
  provider_billing_id: 'pix_char_abc',
  amount_cents: 19_700,
};
const paid = { ...pending, status: 'paid' };

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  writes.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  orderRow = pending;
  requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'a@b.c' });
  requireUser.mockResolvedValue({ id: USER, email: 'u@b.c' });
});

describe('autorização', () => {
  it('não-admin é rejeitado antes de tocar no banco ou no provedor', async () => {
    requireAdmin.mockRejectedValue(new NotFoundError('notFound'));
    await expect(recheckPayment({ orderId: ORDER })).rejects.toBeInstanceOf(NotFoundError);
    await expect(executeRefund({ orderId: ORDER })).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordManualSale({ email: 'a@b.co', courseId: COURSE })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(rpcCalls).toHaveLength(0);
    expect(getPixStatus).not.toHaveBeenCalled();
    expect(refundPixCharge).not.toHaveBeenCalled();
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });

  it('anônimo não pede reembolso', async () => {
    requireUser.mockRejectedValue(new NotFoundError('redirect'));
    await expect(requestRefund({ orderId: ORDER })).rejects.toBeInstanceOf(NotFoundError);
    expect(rpcCalls).toHaveLength(0);
  });

  it('input inválido não chega ao provedor', async () => {
    const res = await recheckPayment({ orderId: 'nao-uuid' });
    expect(res.ok).toBe(false);
    expect(getPixStatus).not.toHaveBeenCalled();
  });
});

describe('recheckPayment', () => {
  it('concede só quando o provedor diz PAID (usa o valor do provedor)', async () => {
    getPixStatus.mockResolvedValue({ status: 'PAID', amountCents: 19_700 });
    fulfillOrderAsService.mockResolvedValue('fulfilled');
    const res = await recheckPayment({ orderId: ORDER });
    expect(res).toMatchObject({ ok: true, data: { granted: true } });
    expect(fulfillOrderAsService).toHaveBeenCalledWith({
      orderId: ORDER,
      billingId: 'pix_char_abc',
      amountCents: 19_700,
    });
  });

  it('sem valor no check usa o valor do pedido', async () => {
    getPixStatus.mockResolvedValue({ status: 'PAID', amountCents: null });
    fulfillOrderAsService.mockResolvedValue('fulfilled');
    await recheckPayment({ orderId: ORDER });
    expect(fulfillOrderAsService).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 19_700 }),
    );
  });

  it.each(['PENDING', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'UNKNOWN'])(
    'provedor %s não concede acesso',
    async (status) => {
      getPixStatus.mockResolvedValue({ status, amountCents: null });
      const res = await recheckPayment({ orderId: ORDER });
      expect(res).toMatchObject({ ok: true, data: { granted: false } });
      expect(fulfillOrderAsService).not.toHaveBeenCalled();
    },
  );

  it('divergência de valor vira erro traduzido', async () => {
    getPixStatus.mockResolvedValue({ status: 'PAID', amountCents: 100 });
    fulfillOrderAsService.mockResolvedValue('amount_mismatch');
    const res = await recheckPayment({ orderId: ORDER });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('valor');
  });

  it('recusa pedido pago/cancelado/sem cobrança sem consultar o provedor', async () => {
    for (const row of [
      { ...pending, status: 'paid' },
      { ...pending, status: 'canceled' },
      { ...pending, provider_billing_id: null },
    ]) {
      orderRow = row;
      expect((await recheckPayment({ orderId: ORDER })).ok).toBe(false);
    }
    expect(getPixStatus).not.toHaveBeenCalled();
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });

  it('provedor fora do ar vira erro amigável e não concede', async () => {
    getPixStatus.mockRejectedValue(new PaymentProviderError('provider_unavailable', 'x'));
    const res = await recheckPayment({ orderId: ORDER });
    expect(res).toMatchObject({ ok: false });
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });
});

describe('executeRefund', () => {
  beforeEach(() => {
    orderRow = paid;
  });

  it('chama o provedor e NÃO revoga acesso nem altera o pedido', async () => {
    refundPixCharge.mockResolvedValue({ alreadyRefunded: false });
    const res = await executeRefund({ orderId: ORDER });
    expect(res).toMatchObject({ ok: true });
    expect((res as { data: { message: string } }).data.message).toContain(
      'o acesso será removido quando a AbacatePay confirmar',
    );
    expect(refundPixCharge).toHaveBeenCalledWith('pix_char_abc');
    expect(writes).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });

  it('INSUFFICIENT_FUNDS mostra mensagem clara', async () => {
    refundPixCharge.mockRejectedValue(new PaymentProviderError('insufficient_funds', 'x'));
    const res = await executeRefund({ orderId: ORDER });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('Saldo insuficiente');
  });

  it('já reembolsada vira sucesso idempotente', async () => {
    refundPixCharge.mockResolvedValue({ alreadyRefunded: true });
    const res = await executeRefund({ orderId: ORDER });
    expect(res).toMatchObject({ ok: true, data: { alreadyRefunded: true } });
  });

  it('só reembolsa pedido pago do checkout com cobrança', async () => {
    for (const row of [
      pending,
      { ...paid, source: 'manual' },
      { ...paid, provider_billing_id: null },
      { ...paid, status: 'refunded' },
    ]) {
      orderRow = row;
      expect((await executeRefund({ orderId: ORDER })).ok).toBe(false);
    }
    orderRow = null;
    expect((await executeRefund({ orderId: ORDER })).ok).toBe(false);
    expect(refundPixCharge).not.toHaveBeenCalled();
  });
});

describe('cartão (PAY-007)', () => {
  const card = { ...pending, provider_billing_id: 'bill_abc', payment_method: 'card' };

  it('reconsulta usa checkouts/get e concede com PAID e valores iguais', async () => {
    orderRow = card;
    getCardCheckoutStatus.mockResolvedValue({
      status: 'PAID',
      amountCents: 19_700,
      paidAmountCents: 19_700,
      externalId: ORDER,
    });
    fulfillOrderAsService.mockResolvedValue('fulfilled');
    const res = await recheckPayment({ orderId: ORDER });
    expect(res).toMatchObject({ ok: true, data: { granted: true } });
    expect(getCardCheckoutStatus).toHaveBeenCalledWith('bill_abc');
    expect(getPixStatus).not.toHaveBeenCalled();
    expect(fulfillOrderAsService).toHaveBeenCalledWith({
      orderId: ORDER,
      billingId: 'bill_abc',
      amountCents: 19_700,
    });
  });

  it('reconsulta com paidAmount diferente (ou outro pedido) não concede', async () => {
    orderRow = card;
    for (const over of [{ paidAmountCents: 1 }, { externalId: 'outro' }]) {
      getCardCheckoutStatus.mockResolvedValue({
        status: 'PAID',
        amountCents: 19_700,
        paidAmountCents: 19_700,
        externalId: ORDER,
        ...over,
      });
      expect((await recheckPayment({ orderId: ORDER })).ok).toBe(false);
    }
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });

  it('reembolso usa checkouts/refund e não altera o pedido', async () => {
    orderRow = { ...card, status: 'paid' };
    refundCardCheckout.mockResolvedValue({ alreadyRefunded: false });
    const res = await executeRefund({ orderId: ORDER });
    expect(res).toMatchObject({ ok: true });
    expect(refundCardCheckout).toHaveBeenCalledWith('bill_abc');
    expect(refundPixCharge).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('recordManualSale', () => {
  it('resolve o aluno pelo email exato e chama a RPC com o client do usuário', async () => {
    rpcResults.admin_students = {
      data: [{ user_id: USER, email: 'Ana@Exemplo.com' }],
      error: null,
    };
    rpcResults.admin_record_manual_sale = { data: ORDER, error: null };
    const res = await recordManualSale({
      email: ' ANA@exemplo.com ',
      courseId: COURSE,
      amount: '197,00',
    });
    expect(res).toMatchObject({ ok: true, data: { orderId: ORDER } });
    expect(rpcCalls.at(-1)).toEqual({
      fn: 'admin_record_manual_sale',
      args: { p_user_id: USER, p_course_id: COURSE, p_amount_cents: 19_700 },
    });
    expect(fulfillOrderAsService).not.toHaveBeenCalled();
  });

  it('email sem conta e compra duplicada', async () => {
    rpcResults.admin_students = { data: [], error: null };
    expect(await recordManualSale({ email: 'x@y.co', courseId: COURSE })).toMatchObject({
      ok: false,
    });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['admin_students']);

    rpcResults.admin_students = { data: [{ user_id: USER, email: 'x@y.co' }], error: null };
    rpcResults.admin_record_manual_sale = { data: null, error: { code: '23505' } };
    const res = await recordManualSale({ email: 'x@y.co', courseId: COURSE });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('compra ativa');
  });

  it('valor inválido é rejeitado antes do banco', async () => {
    const res = await recordManualSale({ email: 'x@y.co', courseId: COURSE, amount: 'abc' });
    expect(res.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('requestRefund (aluno)', () => {
  it('usa a RPC com o id do pedido (dono e prazo são do banco)', async () => {
    rpcResults.request_refund = { data: 'requested', error: null };
    const res = await requestRefund({ orderId: ORDER, userId: 'outro' });
    expect(res.ok).toBe(true);
    expect(rpcCalls).toEqual([{ fn: 'request_refund', args: { p_order_id: ORDER } }]);
  });

  it.each([
    ['not_found', 'não encontrado'],
    ['window_expired', 'prazo de 7 dias'],
    ['already_requested', 'já pediu'],
    ['previously_refunded', 'para este curso'],
    ['not_eligible', 'não é elegível'],
    ['already_refunded', 'já foi reembolsado'],
    ['not_paid', 'pagos'],
  ])('traduz %s', async (code, fragment) => {
    rpcResults.request_refund = { data: code, error: null };
    const res = await requestRefund({ orderId: ORDER });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain(fragment);
  });

  it('erro de banco propaga (sem vazar detalhe)', async () => {
    rpcResults.request_refund = { data: null, error: { code: 'XX000' } };
    await expect(requestRefund({ orderId: ORDER })).rejects.toThrow('Falha ao solicitar');
  });
});
