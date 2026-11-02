// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const SECRET = 'whsec_test_0123456789abcdef';
const DEV_KEY = 'abc_dev_FAKE_KEY_for_tests';
const PROD_KEY = 'abc_prod_FAKE_KEY_for_tests';
const getPaymentsEnv = vi.fn();
vi.mock('@/lib/env/server', () => ({ getPaymentsEnv: () => getPaymentsEnv() }));

// ---------------------------------------------------------------------------
// Supabase fake (service client): orders + payment_events em memória e RPCs espionadas.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type DbError = { code: string; message: string };

const orders = new Map<string, Row>();
const events = new Map<string, Row>();
/** Toda operação feita via `from(tabela)`, para provar que nada além de payment_events é escrito. */
const ops: { table: string; op: string }[] = [];
let dbDown = false;
const rpcResults: Record<string, string[]> = {};
const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  if (dbDown) return { data: null, error: { code: '08006', message: 'down' } };
  const result = rpcResults[fn]?.shift() ?? (fn === 'fulfill_order' ? 'fulfilled' : 'refunded');
  // Imita o efeito das funções no evento (processed_at / processing_error).
  const evt = events.get(String(args.p_event_id));
  if (evt) {
    const ok = [
      'fulfilled',
      'already_paid',
      'paid_already_enrolled',
      'refunded',
      'already_refunded',
    ];
    evt.processed_at = ok.includes(result) ? 'now' : null;
    evt.processing_error =
      result === 'fulfilled' ||
      result === 'already_paid' ||
      result === 'refunded' ||
      result === 'already_refunded'
        ? null
        : `${fn}: ${result}`;
    evt.order_id ??= args.p_order_id;
  }
  return { data: result, error: null };
});

function tableOf(name: string): Map<string, Row> {
  return name === 'orders' ? orders : events;
}

function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Row = {};
  const run = (): { data: unknown; error: DbError | null } => {
    ops.push({ table, op });
    if (dbDown) return { data: null, error: { code: '08006', message: 'down' } };
    const rows = [...tableOf(table).values()].filter((r) => filters.every((f) => f(r)));
    if (op === 'insert') {
      const key = String(payload.provider_event_id);
      if (events.has(key)) return { data: null, error: { code: '23505', message: 'dup' } };
      events.set(key, { processed_at: null, processing_error: null, order_id: null, ...payload });
      return { data: null, error: null };
    }
    if (op === 'update') {
      rows.forEach((r) => Object.assign(r, payload));
      return { data: null, error: null };
    }
    return { data: rows, error: null };
  };
  const b = {
    insert(row: Row) {
      op = 'insert';
      payload = row;
      return b;
    },
    update(patch: Row) {
      op = 'update';
      payload = patch;
      return b;
    },
    select() {
      return b;
    },
    eq(col: string, value: unknown) {
      filters.push((r) => r[col] === value);
      return b;
    },
    neq(col: string, value: unknown) {
      filters.push((r) => r[col] !== value);
      return b;
    },
    limit() {
      return b;
    },
    async maybeSingle() {
      const res = run();
      return { data: (res.data as Row[] | null)?.[0] ?? null, error: res.error };
    },
    then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: (table: string) => query(table), rpc }),
}));

import { signWebhookBody } from '@/lib/payments/abacatepay-webhook';

import {
  MAX_BODY_BYTES,
  defaultWebhookDeps,
  handleAbacatePayWebhook,
  readLimitedText,
  sameBillingId,
  type WebhookInput,
} from './handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORDER_ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601';
const OTHER_ORDER_ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f602';
const BILLING = 'pix_char_abc123';

function seedOrder(over: Row = {}) {
  orders.set(String(over.id ?? ORDER_ID), {
    id: ORDER_ID,
    status: 'pending',
    provider: 'abacatepay',
    provider_billing_id: BILLING,
    amount_cents: 4990,
    ...over,
  });
}

function payload(event: string, over: Record<string, unknown> = {}, charge: Row = {}) {
  return {
    id: 'log_evt_001',
    event,
    apiVersion: 2,
    devMode: true,
    data: {
      transparent: {
        id: BILLING,
        externalId: ORDER_ID,
        amount: 4990,
        paidAmount: 4990,
        platformFee: 80,
        status: 'PAID',
        methods: ['PIX'],
        ...charge,
      },
      customer: {
        id: 'cust_1',
        name: 'Maria Santos',
        email: 'maria@exemplo.com',
        taxId: '123.***.***-**',
      },
      ...(event === 'transparent.disputed' ? { reason: 'requested_by_customer' } : {}),
    },
    ...over,
  };
}

function input(body: unknown, over: Partial<WebhookInput> = {}): WebhookInput {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    webhookSecret: SECRET,
    signature: signWebhookBody(raw),
    contentLength: String(Buffer.byteLength(raw)),
    readBody: async () => raw,
    ...over,
  };
}

const fetchMock = vi.fn();
const pixStatus = (status: string, id = BILLING) =>
  new Response(
    JSON.stringify({ data: { id, status, expiresAt: null }, success: true, error: null }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );

const logs: unknown[][] = [];

function run(body: unknown, over: Partial<WebhookInput> = {}) {
  return handleAbacatePayWebhook(input(body, over));
}

const fulfillCalls = () => rpc.mock.calls.filter(([fn]) => fn === 'fulfill_order');
const refundCalls = () => rpc.mock.calls.filter(([fn]) => fn === 'refund_order');
const event = (id = 'log_evt_001') => events.get(id);

beforeEach(() => {
  orders.clear();
  events.clear();
  ops.length = 0;
  logs.length = 0;
  dbDown = false;
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  rpc.mockClear();
  fetchMock.mockReset();
  getPaymentsEnv.mockReset();
  getPaymentsEnv.mockReturnValue({
    ABACATEPAY_API_KEY: DEV_KEY,
    ABACATEPAY_WEBHOOK_SECRET: SECRET,
  });
  vi.stubGlobal('fetch', fetchMock);
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Nada além de payment_events é escrito por `from()`: acesso só via RPC. */
function expectNoDirectAccessWrites() {
  const writes = ops.filter((o) => o.op !== 'select');
  expect(writes.every((o) => o.table === 'payment_events')).toBe(true);
}

// ---------------------------------------------------------------------------
// Autenticação, tamanho e parse
// ---------------------------------------------------------------------------
describe('verificação', () => {
  it('segredo errado → 401, sem tocar no banco', async () => {
    seedOrder();
    const res = await run(payload('transparent.completed'), {
      webhookSecret: 'whsec_test_0123456789abcdeX',
    });
    expect(res.status).toBe(401);
    expect(ops).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('segredo ausente ou de outro tamanho → 401', async () => {
    expect((await run(payload('transparent.completed'), { webhookSecret: null })).status).toBe(401);
    expect((await run(payload('transparent.completed'), { webhookSecret: 'curto' })).status).toBe(
      401,
    );
  });

  it('assinatura inválida ou ausente → 401', async () => {
    const raw = JSON.stringify(payload('transparent.completed'));
    expect((await run(raw, { signature: signWebhookBody(raw + ' ') })).status).toBe(401);
    expect((await run(raw, { signature: null })).status).toBe(401);
    expect(ops).toHaveLength(0);
  });

  it('corpo alterado depois de assinado → 401', async () => {
    const raw = JSON.stringify(payload('transparent.completed'));
    const tampered = raw.replace('4990', '1');
    const res = await run(tampered, { signature: signWebhookBody(raw) });
    expect(res.status).toBe(401);
  });

  it('corpo grande → 413 (Content-Length ou leitura)', async () => {
    const readBody = vi.fn(async () => 'x');
    const declared = await run(payload('transparent.completed'), {
      contentLength: String(MAX_BODY_BYTES + 1),
      readBody,
    });
    expect(declared.status).toBe(413);
    expect(readBody).not.toHaveBeenCalled();

    const streamed = await run(payload('transparent.completed'), {
      contentLength: null,
      readBody: async () => null,
    });
    expect(streamed.status).toBe(413);
    expect(ops).toHaveLength(0);
  });

  it('JSON ilegível ou sem campos → 400', async () => {
    expect((await run('{nope')).status).toBe(400);
    expect((await run({ event: 'transparent.completed' })).status).toBe(400);
    expect((await run({ data: {} })).status).toBe(400);
  });

  it('sem env de pagamentos → 503 (re-tentado)', async () => {
    getPaymentsEnv.mockImplementation(() => {
      throw new Error('Variáveis ausentes: ABACATEPAY_API_KEY');
    });
    expect((await run(payload('transparent.completed'))).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// transparent.completed
// ---------------------------------------------------------------------------
describe('transparent.completed', () => {
  it('reconsulta PAID → fulfill_order com cobrança do pedido e valor do provedor', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'fulfilled' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`/transparents/check?id=${BILLING}`);
    expect(fulfillCalls()).toEqual([
      [
        'fulfill_order',
        {
          p_order_id: ORDER_ID,
          p_provider_billing_id: BILLING,
          p_amount_cents: 4990,
          p_event_id: 'log_evt_001',
        },
      ],
    ]);
    expect(event()).toMatchObject({
      event_type: 'transparent.completed',
      processed_at: 'now',
      processing_error: null,
    });
    expectNoDirectAccessWrites();
  });

  it('payload guardado sem dados do pagador', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    await run(payload('transparent.completed'));
    const stored = JSON.stringify(event()!.payload);
    expect(stored).not.toContain('maria');
    expect(stored).not.toContain('Maria');
    expect(stored).toContain(ORDER_ID);
  });

  it.each(['EXPIRED', 'CANCELLED', 'FAILED', 'UNDER_DISPUTE', 'REFUNDED', 'whatever'])(
    'reconsulta %s ≠ PAID → não chama fulfill_order',
    async (status) => {
      seedOrder();
      fetchMock.mockResolvedValueOnce(pixStatus(status));
      const res = await run(payload('transparent.completed'));
      expect(res.status).toBe(200);
      expect(fulfillCalls()).toHaveLength(0);
      expect(event()!.processing_error).toMatch(/^provider_status_/);
      expect(event()!.processed_at).toBeNull();
      expectNoDirectAccessWrites();
    },
  );

  it('reconsulta PENDING → 503 sem processing_error; re-tentativa com PAID → fulfill', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PENDING'));
    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 503, body: { ok: false, result: 'provider_pending' } });
    expect(fulfillCalls()).toHaveLength(0);
    expect(event()).toMatchObject({ processed_at: null, processing_error: null });
    expectNoDirectAccessWrites();

    // A AbacatePay re-tenta com o mesmo id: não é "duplicado", reprocessa.
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const retry = await run(payload('transparent.completed'));
    expect(retry).toEqual({ status: 200, body: { ok: true, result: 'fulfilled' } });
    expect(fulfillCalls()).toHaveLength(1);
    expect(event()).toMatchObject({ processed_at: 'now', processing_error: null });
  });

  it('status do payload é ignorado: decide pela reconsulta', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PENDING'));
    await run(payload('transparent.completed', {}, { status: 'PAID' }));
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('amount_mismatch → 200 + processing_error (registrado pelo fulfill_order)', async () => {
    seedOrder();
    rpcResults.fulfill_order = ['amount_mismatch'];
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const res = await run(payload('transparent.completed', {}, { amount: 1 }));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'amount_mismatch' } });
    expect(fulfillCalls()[0]![1]).toMatchObject({ p_amount_cents: 1 });
    expect(event()!.processing_error).toBe('fulfill_order: amount_mismatch');
  });

  it('QA-002: reconsulta com valor ≠ do pedido → amount_mismatch, sem fulfill (evento forjado com valor do pedido)', async () => {
    // Cobrança mais barata, mas o evento (forjado com o segredo vazado) diz o valor do pedido.
    seedOrder({ status: 'failed', provider_billing_id: null });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { id: 'pix_char_cheap', status: 'PAID', amount: 100, expiresAt: null },
          success: true,
          error: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await run(payload('transparent.completed', {}, { id: 'pix_char_cheap' }));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'amount_mismatch' } });
    expect(fulfillCalls()).toHaveLength(0);
    expect(event()!.processing_error).toBe('amount_mismatch');
  });

  it('reconsulta com o mesmo valor do pedido → fulfill', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { id: BILLING, status: 'PAID', amount: 4990, expiresAt: null },
          success: true,
          error: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await run(payload('transparent.completed'));
    expect(res.body.result).toBe('fulfilled');
  });

  it('sem amount no payload → amount_mismatch sem chamar o provedor', async () => {
    seedOrder();
    const res = await run(payload('transparent.completed', {}, { amount: undefined }));
    expect(res.body.result).toBe('amount_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fulfillCalls()).toHaveLength(0);
    expect(event()!.processing_error).toBe('amount_mismatch');
  });

  it('pedido inexistente ou externalId inválido → 200 + order_not_found', async () => {
    const res = await run(payload('transparent.completed'));
    expect(res.body.result).toBe('order_not_found');
    expect(event()!.processing_error).toBe('order_not_found');

    const bad = await run(
      payload('transparent.completed', { id: 'log_evt_002' }, { externalId: 'pedido-456' }),
    );
    expect(bad).toEqual({ status: 200, body: { ok: true, result: 'order_not_found' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('cobrança do evento ≠ do pedido → billing_mismatch, sem reconsulta', async () => {
    seedOrder();
    const res = await run(payload('transparent.completed', {}, { id: 'pix_char_OUTRA' }));
    expect(res.body.result).toBe('billing_mismatch');
    expect(event()!.order_id).toBe(ORDER_ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('id do evento `char_…` casa com o `pix_char_…` gravado', async () => {
    expect(sameBillingId('pix_char_abc', 'char_abc')).toBe(true);
    expect(sameBillingId('pix_char_abc', 'pix_char_abc')).toBe(true);
    expect(sameBillingId('pix_char_abc', 'char_abd')).toBe(false);
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const res = await run(payload('transparent.completed', {}, { id: 'char_abc123' }));
    expect(res.body.result).toBe('fulfilled');
    expect(fulfillCalls()[0]![1]).toMatchObject({ p_provider_billing_id: BILLING });
  });

  it('pedido failed sem cobrança gravada (timeout no PAY-002) → reconsulta a cobrança do evento', async () => {
    seedOrder({ status: 'failed', provider_billing_id: null });
    fetchMock.mockResolvedValueOnce(pixStatus('PAID', 'pix_char_late'));
    const res = await run(payload('transparent.completed', {}, { id: 'pix_char_late' }));
    expect(res.body.result).toBe('fulfilled');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('id=pix_char_late');
    expect(fulfillCalls()[0]![1]).toMatchObject({
      p_order_id: ORDER_ID,
      p_provider_billing_id: 'pix_char_late',
    });
  });

  it('cobrança do evento já pertence a outro pedido → billing_mismatch', async () => {
    seedOrder({ status: 'failed', provider_billing_id: null });
    seedOrder({ id: OTHER_ORDER_ID, provider_billing_id: 'pix_char_late', status: 'paid' });
    const res = await run(payload('transparent.completed', {}, { id: 'pix_char_late' }));
    expect(res.body.result).toBe('billing_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('pedido já pago → 200 already_paid, sem reconsulta nem RPC', async () => {
    seedOrder({ status: 'paid' });
    const res = await run(payload('transparent.completed'));
    expect(res.body.result).toBe('already_paid');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(event()!.processed_at).not.toBeNull();
  });

  it('pedido cancelado → invalid_status, sem conceder', async () => {
    seedOrder({ status: 'canceled' });
    const res = await run(payload('transparent.completed'));
    expect(res.body.result).toBe('invalid_status');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cobrança recusada pelo provedor (4xx) → erro de dado, 200', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'provider_check_rejected' } });
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('provedor indisponível → 500 e o evento fica pendente para a re-tentativa', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 500, body: { ok: false, result: 'temporary_failure' } });
    expect(event()).toMatchObject({ processed_at: null, processing_error: null });

    // Re-tentativa com o mesmo id: reprocessa (não é "duplicado").
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const retry = await run(payload('transparent.completed'));
    expect(retry.body.result).toBe('fulfilled');
    expect(fulfillCalls()).toHaveLength(1);
  });

  it('sem id de topo → chave determinística evento+cobrança (dedupe das re-tentativas)', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    await run(payload('transparent.completed', { id: undefined }));
    expect(events.has(`transparent.completed:${BILLING}`)).toBe(true);
    const again = await run(payload('transparent.completed', { id: undefined }));
    expect(again.body.result).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------
// Dedupe e falhas do banco
// ---------------------------------------------------------------------------
describe('dedupe e banco', () => {
  it('evento duplicado → 200 sem efeito', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    await run(payload('transparent.completed'));
    rpc.mockClear();
    fetchMock.mockClear();

    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'duplicate' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('evento com erro de dado já registrado → duplicado', async () => {
    const first = await run(payload('transparent.completed'));
    expect(first.body.result).toBe('order_not_found');
    seedOrder();
    expect((await run(payload('transparent.completed'))).body.result).toBe('duplicate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('banco indisponível → 500', async () => {
    seedOrder();
    dbDown = true;
    const res = await run(payload('transparent.completed'));
    expect(res).toEqual({ status: 500, body: { ok: false, result: 'temporary_failure' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('RPC falha → 500', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock' } });
    const res = await run(payload('transparent.completed'));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Reembolso, disputa, ambiente
// ---------------------------------------------------------------------------
describe('reembolso e disputa', () => {
  it('transparent.refunded → reconsulta REFUNDED → refund_order', async () => {
    seedOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(pixStatus('REFUNDED'));
    const res = await run(payload('transparent.refunded'));
    expect(res.body.result).toBe('refunded');
    expect(refundCalls()).toEqual([
      ['refund_order', { p_order_id: ORDER_ID, p_event_id: 'log_evt_001' }],
    ]);
    expect(fulfillCalls()).toHaveLength(0);
    expectNoDirectAccessWrites();
  });

  it('transparent.lost → refund_order', async () => {
    seedOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(pixStatus('REFUNDED'));
    const res = await run(payload('transparent.lost'));
    expect(res.body.result).toBe('refunded');
    expect(refundCalls()).toHaveLength(1);
  });

  it('refunded com reconsulta ainda PAID → não revoga, registra erro', async () => {
    seedOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const res = await run(payload('transparent.refunded'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'provider_status_paid' } });
    expect(refundCalls()).toHaveLength(0);
  });

  it('refunded de pedido já reembolsado → refund_order idempotente, sem reconsulta', async () => {
    seedOrder({ status: 'refunded' });
    rpcResults.refund_order = ['already_refunded'];
    const res = await run(payload('transparent.refunded'));
    expect(res.body.result).toBe('already_refunded');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('transparent.disputed → só registra (sem RPC, sem reconsulta) e alerta', async () => {
    seedOrder({ status: 'paid' });
    const res = await run(payload('transparent.disputed'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'dispute_recorded' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(event()).toMatchObject({ order_id: ORDER_ID, processing_error: null });
    expect(event()!.processed_at).not.toBeNull();
    expect(logs.some((l) => String(l[0]).includes('ALERTA'))).toBe(true);
  });

  it('evento desconhecido → registrado como unsupported_event, 200', async () => {
    const res = await run(payload('subscription.completed'));
    expect(res.body.result).toBe('unsupported_event');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('devMode em produção → 200 ignorado, sem gravar nada', async () => {
    getPaymentsEnv.mockReturnValue({
      ABACATEPAY_API_KEY: PROD_KEY,
      ABACATEPAY_WEBHOOK_SECRET: SECRET,
    });
    seedOrder();
    const res = await run(payload('transparent.completed', { devMode: true }));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'ignored_dev_mode' } });
    expect(ops).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('produção com devMode false → processa', async () => {
    getPaymentsEnv.mockReturnValue({
      ABACATEPAY_API_KEY: PROD_KEY,
      ABACATEPAY_WEBHOOK_SECRET: SECRET,
    });
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    const res = await run(payload('transparent.completed', { devMode: false }));
    expect(res.body.result).toBe('fulfilled');
  });
});

// ---------------------------------------------------------------------------
// Cartão: checkout hospedado (PAY-007)
// ---------------------------------------------------------------------------
const CARD_BILLING = 'bill_abc123xyz';

function seedCardOrder(over: Row = {}) {
  seedOrder({ payment_method: 'card', provider_billing_id: CARD_BILLING, ...over });
}

function cardPayload(event: string, over: Record<string, unknown> = {}, checkout: Row = {}) {
  return {
    id: 'log_card_001',
    event,
    apiVersion: 2,
    devMode: true,
    data: {
      checkout: {
        id: CARD_BILLING,
        externalId: ORDER_ID,
        url: `https://app.abacatepay.com/pay/${CARD_BILLING}`,
        amount: 4990,
        paidAmount: 4990,
        platformFee: 602,
        frequency: 'ONE_TIME',
        status: 'PAID',
        methods: ['CARD'],
        installmentsCount: 3,
        ...checkout,
      },
      customer: {
        id: 'cust_1',
        name: 'Maria Santos',
        email: 'maria@exemplo.com',
        taxId: '123.***.***-**',
      },
      payerInformation: { method: 'CARD', CARD: { number: '4242', brand: 'VISA' } },
      ...(event === 'checkout.disputed' ? { reason: 'requested_by_customer' } : {}),
    },
    ...over,
  };
}

const checkoutStatus = (status: string, over: Row = {}) =>
  new Response(
    JSON.stringify({
      data: {
        id: CARD_BILLING,
        externalId: ORDER_ID,
        status,
        amount: 4990,
        paidAmount: status === 'PAID' ? 4990 : null,
        ...over,
      },
      success: true,
      error: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('checkout.* (cartão)', () => {
  it('checkout.completed → reconsulta checkouts/get PAID → fulfill_order com o bill_ do pedido', async () => {
    seedCardOrder();
    fetchMock.mockResolvedValueOnce(checkoutStatus('PAID'));
    const res = await run(cardPayload('checkout.completed'));
    expect(res).toEqual({ status: 200, body: { ok: true, result: 'fulfilled' } });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://api.abacatepay.com/v2/checkouts/get?id=${CARD_BILLING}`,
    );
    expect(fulfillCalls()).toEqual([
      [
        'fulfill_order',
        {
          p_order_id: ORDER_ID,
          p_provider_billing_id: CARD_BILLING,
          p_amount_cents: 4990,
          p_event_id: 'log_card_001',
        },
      ],
    ]);
    expect(event('log_card_001')!.payload).toMatchObject({
      data: { checkout: { id: CARD_BILLING, externalId: ORDER_ID, amount: 4990 } },
    });
    expect(JSON.stringify(event('log_card_001')!.payload)).not.toContain('4242');
    expectNoDirectAccessWrites();
  });

  it('reconsulta PENDING → 503 (re-tentado), sem conceder', async () => {
    seedCardOrder();
    fetchMock.mockResolvedValueOnce(checkoutStatus('PENDING'));
    const res = await run(cardPayload('checkout.completed'));
    expect(res.status).toBe(503);
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('reconsulta com paidAmount ≠ pedido (ex.: cupom) → amount_mismatch, sem conceder', async () => {
    seedCardOrder();
    fetchMock.mockResolvedValueOnce(checkoutStatus('PAID', { paidAmount: 100 }));
    const res = await run(cardPayload('checkout.completed'));
    expect(res.body.result).toBe('amount_mismatch');
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('reconsulta de checkout de outro pedido → billing_mismatch', async () => {
    seedCardOrder();
    fetchMock.mockResolvedValueOnce(checkoutStatus('PAID', { externalId: OTHER_ORDER_ID }));
    const res = await run(cardPayload('checkout.completed'));
    expect(res.body.result).toBe('billing_mismatch');
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('REDEEMED (cupom 100%) não libera', async () => {
    seedCardOrder();
    fetchMock.mockResolvedValueOnce(checkoutStatus('REDEEMED', { paidAmount: 0 }));
    const res = await run(cardPayload('checkout.completed'));
    expect(res.body.result).not.toBe('fulfilled');
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('evento de checkout para pedido PIX (e vice-versa) → method_mismatch, sem reconsulta', async () => {
    seedOrder();
    const a = await run(cardPayload('checkout.completed'));
    expect(a.body.result).toBe('method_mismatch');
    orders.clear();
    seedCardOrder();
    const b = await run(payload('transparent.completed', { id: 'log_evt_x' }));
    expect(b.body.result).toBe('method_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fulfillCalls()).toHaveLength(0);
  });

  it('checkout.refunded e checkout.lost → reconsulta REFUNDED → refund_order', async () => {
    seedCardOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(checkoutStatus('REFUNDED'));
    expect((await run(cardPayload('checkout.refunded'))).body.result).toBe('refunded');
    seedCardOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(checkoutStatus('REFUNDED'));
    expect((await run(cardPayload('checkout.lost', { id: 'log_card_002' }))).body.result).toBe(
      'refunded',
    );
    expect(refundCalls()).toHaveLength(2);
  });

  it('checkout.refunded com reconsulta ainda PAID → não revoga', async () => {
    seedCardOrder({ status: 'paid' });
    fetchMock.mockResolvedValueOnce(checkoutStatus('PAID'));
    const res = await run(cardPayload('checkout.refunded'));
    expect(res.body.result).toBe('provider_status_paid');
    expect(refundCalls()).toHaveLength(0);
  });

  it('checkout.disputed → só registra e alerta chargeback', async () => {
    seedCardOrder({ status: 'paid' });
    const res = await run(cardPayload('checkout.disputed'));
    expect(res.body.result).toBe('dispute_recorded');
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((l) => String(l[0]).includes('chargeback'))).toBe(true);
  });
});

describe('logs', () => {
  it('nunca contêm o segredo, a URL nem dados do pagador', async () => {
    seedOrder();
    fetchMock.mockResolvedValueOnce(pixStatus('PAID'));
    await run(payload('transparent.completed'));
    await run(payload('transparent.completed'), { webhookSecret: 'errado' });
    await run(payload('transparent.disputed', { id: 'log_evt_009' }));
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('webhookSecret');
    expect(text).not.toContain('maria');
    expect(text).not.toContain(DEV_KEY);
  });
});

describe('readLimitedText', () => {
  const streamOf = (...parts: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
        controller.close();
      },
    });

  it('junta os pedaços (UTF-8) dentro do limite', async () => {
    expect(await readLimitedText(streamOf('{"a":', '"ção"}'), 100)).toBe('{"a":"ção"}');
    expect(await readLimitedText(null, 100)).toBe('');
  });

  it('passa do limite → null', async () => {
    expect(await readLimitedText(streamOf('x'.repeat(60), 'y'.repeat(60)), 100)).toBeNull();
  });
});

describe('defaultWebhookDeps', () => {
  it('lê segredo e chave do env do servidor', () => {
    expect(defaultWebhookDeps().getConfig()).toEqual({ webhookSecret: SECRET, apiKey: DEV_KEY });
  });
});
