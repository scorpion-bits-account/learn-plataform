import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

const requireUser = vi.fn();
vi.mock('@/lib/auth/dal', () => ({
  requireUser: () => requireUser(),
  requireAdmin: vi.fn(),
}));

const getPublishedCourse = vi.fn();
vi.mock('@/features/catalog/queries', () => ({
  getPublishedCourse: (slug: string) => getPublishedCourse(slug),
}));

const KEY = 'abc_dev_FAKE_KEY_for_tests';
const getPaymentsEnv = vi.fn();
vi.mock('@/lib/env/server', () => ({ getPaymentsEnv: () => getPaymentsEnv() }));

// ---------------------------------------------------------------------------
// Supabase fake: registra as chamadas e responde por `<client>.<tabela>.<op inicial>`.
// ---------------------------------------------------------------------------
type Res = { data: unknown; error: unknown };
type Call = { client: string; table: string; ops: { op: string; args: unknown[] }[] };
const calls: Call[] = [];
let responses: Record<string, Res[]> = {};
let defaults: Record<string, Res> = {};

function respond(key: string): Res {
  return responses[key]?.shift() ?? defaults[key] ?? { data: null, error: null };
}

function builder(client: string, table: string) {
  const call: Call = { client, table, ops: [] };
  calls.push(call);
  const key = () => `${client}.${table}.${call.ops[0]?.op}`;
  const b: Record<string, unknown> = {};
  for (const op of ['insert', 'update', 'select', 'eq', 'is']) {
    b[op] = (...args: unknown[]) => {
      call.ops.push({ op, args });
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(respond(key()));
  b.single = () => Promise.resolve(respond(key()));
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(respond(key())).then(res, rej);
  return b;
}

const rpc = vi.fn(async (fn: string, args: unknown) => {
  calls.push({ client: 'user', table: `rpc:${fn}`, ops: [{ op: 'rpc', args: [args] }] });
  return respond(`user.rpc.${fn}`);
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => builder('user', t), rpc })),
}));
const createServiceClient = vi.fn(() => ({ from: (t: string) => builder('service', t) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => createServiceClient() }));

import { startCheckout } from './actions';

// ---------------------------------------------------------------------------

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'ana@exemplo.com' };
const COURSE = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  slug: 'godot-do-zero',
  title: 'Godot do zero',
  priceCents: 19700,
};
const ORDER = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER = '22222222-2222-4222-8222-222222222222';
const CPF = '111.444.777-35';
const input = { courseSlug: COURSE.slug, taxId: CPF, phone: '(11) 94002-8922' };

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const okCharge = {
  data: {
    id: 'pix_char_abc123',
    amount: COURSE.priceCents,
    status: 'PENDING',
    brCode: '00020160014BR.GOV.BCB.PIX',
    brCodeBase64: 'data:image/png;base64,iVBORw0KG==',
    expiresAt: '2026-10-08T21:00:00.000Z',
  },
  success: true,
  error: null,
};

const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const agoMinutes = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const of = (client: string, table: string, firstOp: string) =>
  calls.filter((c) => c.client === client && c.table === table && c.ops[0]?.op === firstOp);
const argsOf = (call: Call, op: string) => call.ops.filter((o) => o.op === op).map((o) => o.args);

async function run(payload: unknown = input) {
  return startCheckout(payload).then(
    (result) => ({ result, redirectTo: null as string | null }),
    (error: unknown) => {
      if (error instanceof RedirectError) return { result: null, redirectTo: error.url };
      throw error;
    },
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  responses = {};
  defaults = {
    'user.rpc.has_course_access': { data: false, error: null },
    'user.profiles.update': { data: { full_name: 'Ana Souza' }, error: null },
    'user.orders.select': { data: null, error: null },
    'service.orders.insert': { data: { id: ORDER }, error: null },
    'service.orders.update': { data: [{ id: ORDER }], error: null },
  };
  requireUser.mockResolvedValue(USER);
  getPublishedCourse.mockResolvedValue({ ...COURSE });
  getPaymentsEnv.mockReturnValue({ ABACATEPAY_API_KEY: KEY, ABACATEPAY_WEBHOOK_SECRET: 'x' });
  fetchMock.mockResolvedValue(json(okCharge));
  vi.stubGlobal('fetch', fetchMock);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

function expectNoLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain('11144477735');
  expect(text).not.toContain(CPF);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('94002');
}

describe('autorização e validação', () => {
  it('anônimo é rejeitado antes de ler input, banco ou provedor', async () => {
    requireUser.mockRejectedValue(new RedirectError('/entrar'));
    const { redirectTo } = await run();
    expect(redirectTo).toBe('/entrar');
    expect(calls).toHaveLength(0);
    expect(getPublishedCourse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CPF inválido -> erro no campo, nada no banco', async () => {
    const { result } = await run({ ...input, taxId: '111.444.777-36' });
    expect(result).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.any(String)] } });
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('telefone inválido -> erro no campo', async () => {
    const { result } = await run({ ...input, phone: '(11) 84002-8922' });
    expect(result).toMatchObject({ ok: false, fieldErrors: { phone: [expect.any(String)] } });
    expect(calls).toHaveLength(0);
  });
});

describe('regras do curso', () => {
  it('curso inexistente ou em rascunho (fora do catálogo) -> erro amigável', async () => {
    getPublishedCourse.mockResolvedValue(null);
    const { result } = await run();
    expect(result).toEqual({ ok: false, error: 'Este curso não está disponível para compra.' });
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('curso sem preço -> erro amigável', async () => {
    getPublishedCourse.mockResolvedValue({ ...COURSE, priceCents: 0 });
    const { result } = await run();
    expect(result).toMatchObject({ ok: false });
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
  });

  it('já possui acesso -> "already_owned" com link, sem pedido', async () => {
    defaults['user.rpc.has_course_access'] = { data: true, error: null };
    const { result } = await run();
    expect(result).toEqual({
      ok: true,
      data: { status: 'already_owned', href: '/aprender/godot-do-zero' },
    });
    expect(rpc).toHaveBeenCalledWith('has_course_access', { p_course_id: COURSE.id });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('criação do pedido', () => {
  it('usa o preço do banco e o user_id da sessão (ignora o input)', async () => {
    const { redirectTo } = await run({
      ...input,
      amountCents: 1,
      amount_cents: 1,
      price: 1,
      userId: 'hacker',
      user_id: 'hacker',
    });
    expect(redirectTo).toBe(`/checkout/pedido/${ORDER}`);

    // perfil: só dígitos, só o próprio usuário, client do usuário
    const [profile] = of('user', 'profiles', 'update');
    expect(argsOf(profile!, 'update')[0]![0]).toEqual({
      tax_id: '11144477735',
      phone: '11940028922',
    });
    expect(argsOf(profile!, 'eq')).toContainEqual(['id', USER.id]);

    // pedido: service client, valores montados no servidor
    const [insert] = of('service', 'orders', 'insert');
    expect(argsOf(insert!, 'insert')[0]![0]).toEqual({
      user_id: USER.id,
      course_id: COURSE.id,
      payment_method: 'pix',
      amount_cents: 19700,
      status: 'pending',
      source: 'checkout',
      provider: 'abacatepay',
    });

    // cobrança: valor do banco, externalId = pedido, expiresIn 3600
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.data).toMatchObject({
      amount: 19700,
      externalId: ORDER,
      expiresIn: 3600,
      metadata: { orderId: ORDER, courseId: COURSE.id },
      customer: { name: 'Ana Souza', email: USER.email, taxId: CPF, cellphone: '(11) 94002-8922' },
    });

    // grava a cobrança só no pedido pendente
    const [save] = of('service', 'orders', 'update');
    expect(argsOf(save!, 'update')[0]![0]).toEqual({
      provider_billing_id: 'pix_char_abc123',
      pix_br_code: '00020160014BR.GOV.BCB.PIX',
      pix_br_code_base64: 'data:image/png;base64,iVBORw0KG==',
      expires_at: '2026-10-08T21:00:00.000Z',
    });
    expect(argsOf(save!, 'eq')).toEqual([
      ['id', ORDER],
      ['status', 'pending'],
    ]);
  });

  it('nome vazio no perfil -> usa o email como nome do cliente', async () => {
    defaults['user.profiles.update'] = { data: { full_name: '  ' }, error: null };
    await run();
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.data.customer.name).toBe(USER.email);
  });

  it('sem env de pagamento -> erro amigável e nenhum pedido criado', async () => {
    getPaymentsEnv.mockImplementation(() => {
      throw new Error('env');
    });
    const { result } = await run();
    expect(result).toMatchObject({ ok: false });
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
  });
});

describe('pedido pendente', () => {
  it('reaproveita pendente com QR válido (sem novo pedido nem cobrança)', async () => {
    responses['user.orders.select'] = [
      {
        data: {
          id: OTHER_ORDER,
          expires_at: inMinutes(30),
          pix_br_code: '000201',
          created_at: agoMinutes(5),
        },
        error: null,
      },
    ];
    const { redirectTo } = await run();
    expect(redirectTo).toBe(`/checkout/pedido/${OTHER_ORDER}`);
    const [read] = of('user', 'orders', 'select');
    expect(argsOf(read!, 'eq')).toEqual([
      ['user_id', USER.id],
      ['course_id', COURSE.id],
      ['status', 'pending'],
    ]);
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pendente com QR vencido -> marca expired e cria outro', async () => {
    responses['user.orders.select'] = [
      {
        data: {
          id: OTHER_ORDER,
          expires_at: agoMinutes(1),
          pix_br_code: '000201',
          created_at: agoMinutes(70),
        },
        error: null,
      },
    ];
    const { redirectTo } = await run();
    expect(redirectTo).toBe(`/checkout/pedido/${ORDER}`);
    const [expire] = of('service', 'orders', 'update');
    expect(argsOf(expire!, 'update')[0]![0]).toEqual({ status: 'expired' });
    expect(argsOf(expire!, 'eq')).toEqual([
      ['id', OTHER_ORDER],
      ['status', 'pending'],
    ]);
    expect(of('service', 'orders', 'insert')).toHaveLength(1);
  });

  it('pendente sem QR recente (outra aba gerando) -> erro amigável, sem novo pedido', async () => {
    responses['user.orders.select'] = [
      {
        data: { id: OTHER_ORDER, expires_at: null, pix_br_code: null, created_at: agoMinutes(0.2) },
        error: null,
      },
    ];
    const { result } = await run();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/sendo gerado/) });
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pendente sem QR abandonado -> marca failed e cria outro', async () => {
    responses['user.orders.select'] = [
      {
        data: { id: OTHER_ORDER, expires_at: null, pix_br_code: null, created_at: agoMinutes(30) },
        error: null,
      },
    ];
    const { redirectTo } = await run();
    expect(redirectTo).toBe(`/checkout/pedido/${ORDER}`);
    expect(argsOf(of('service', 'orders', 'update')[0]!, 'update')[0]![0]).toEqual({
      status: 'failed',
    });
  });

  it('corrida 23505 -> relê e reaproveita o pedido vencedor', async () => {
    responses['service.orders.insert'] = [{ data: null, error: { code: '23505' } }];
    responses['user.orders.select'] = [
      { data: null, error: null },
      {
        data: {
          id: OTHER_ORDER,
          expires_at: inMinutes(59),
          pix_br_code: '000201',
          created_at: agoMinutes(0),
        },
        error: null,
      },
    ];
    const { redirectTo } = await run();
    expect(redirectTo).toBe(`/checkout/pedido/${OTHER_ORDER}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('corrida 23505 com o vencedor ainda sem QR -> erro amigável', async () => {
    responses['service.orders.insert'] = [{ data: null, error: { code: '23505' } }];
    responses['user.orders.select'] = [
      { data: null, error: null },
      {
        data: { id: OTHER_ORDER, expires_at: null, pix_br_code: null, created_at: agoMinutes(0) },
        error: null,
      },
    ];
    const { result } = await run();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/sendo gerado/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('falhas do provedor', () => {
  it('erro do provedor marca o pedido como failed e não vaza detalhes', async () => {
    fetchMock.mockResolvedValue(
      json({ data: null, success: false, error: `Invalid taxId 111.444.777-35 key ${KEY}` }, 500),
    );
    const { result } = await run();
    expect(result).toEqual({
      ok: false,
      error:
        'Não conseguimos gerar o PIX agora. Nenhum valor foi cobrado. Tente novamente em instantes.',
    });
    const [fail] = of('service', 'orders', 'update');
    expect(argsOf(fail!, 'update')[0]![0]).toEqual({ status: 'failed' });
    expect(argsOf(fail!, 'eq')).toEqual([
      ['id', ORDER],
      ['status', 'pending'],
    ]);
    expectNoLeak(result);
    expectNoLeak(consoleError.mock.calls);
  });

  it('401 (chave sem permissão) também vira erro amigável', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Insufficient permissions' }, 401));
    const { result } = await run();
    expect(result).toMatchObject({ ok: false });
    expect(argsOf(of('service', 'orders', 'update')[0]!, 'update')[0]![0]).toEqual({
      status: 'failed',
    });
    expectNoLeak(consoleError.mock.calls);
  });

  it('timeout do provedor -> failed + erro amigável', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = run();
    await vi.advanceTimersByTimeAsync(10_000);
    const { result } = await pending;
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/gerar o PIX/) });
    expect(argsOf(of('service', 'orders', 'update')[0]!, 'update')[0]![0]).toEqual({
      status: 'failed',
    });
  });

  it('falha ao gravar a cobrança -> failed + erro amigável', async () => {
    responses['service.orders.update'] = [{ data: null, error: { code: '23514' } }];
    const { result } = await run();
    expect(result).toMatchObject({ ok: false });
    const updates = of('service', 'orders', 'update');
    expect(updates).toHaveLength(2);
    expect(argsOf(updates[1]!, 'update')[0]![0]).toEqual({ status: 'failed' });
  });
});

describe('cartão (checkout hospedado, PAY-007)', () => {
  const cardInput = { courseSlug: COURSE.slug, paymentMethod: 'card' };
  const BILL = 'bill_abc123xyz';
  const PAY_URL = `https://app.abacatepay.com/pay/${BILL}`;
  const product = {
    data: { id: 'prod_abc', price: COURSE.priceCents, externalId: 'x' },
    success: true,
    error: null,
  };
  const checkout = (over: Record<string, unknown> = {}) => ({
    data: {
      id: BILL,
      url: PAY_URL,
      amount: COURSE.priceCents,
      status: 'PENDING',
      externalId: ORDER,
      ...over,
    },
    success: true,
    error: null,
  });
  const notFound = () =>
    json({ data: null, success: false, error: 'Produto não encontrado.' }, 404);
  const pathOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0])).pathname;
  const bodyOf = (i: number) =>
    JSON.parse((fetchMock.mock.calls[i]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://learn.example.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x');
    vi.stubEnv('ABACATEPAY_API_BASE_URL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sem CPF/telefone: cria produto espelho (404 → create), checkout só CARD e redireciona para a AbacatePay', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(json(product))
      .mockResolvedValueOnce(json(checkout()));
    const { redirectTo } = await run({ ...cardInput, amountCents: 1, taxId: 'lixo' });
    expect(redirectTo).toBe(PAY_URL);

    // não grava CPF/telefone no perfil
    expect(of('user', 'profiles', 'update')).toHaveLength(0);

    const [insert] = of('service', 'orders', 'insert');
    expect(argsOf(insert!, 'insert')[0]![0]).toMatchObject({
      amount_cents: 19700,
      payment_method: 'card',
      user_id: USER.id,
    });

    expect(pathOf(0)).toBe('/v2/products/get');
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`externalId=course-${COURSE.id}-19700`);
    expect(pathOf(1)).toBe('/v2/products/create');
    expect(bodyOf(1)).toEqual({
      externalId: `course-${COURSE.id}-19700`,
      name: COURSE.title,
      price: 19700,
      currency: 'BRL',
    });
    expect(pathOf(2)).toBe('/v2/checkouts/create');
    expect(bodyOf(2)).toEqual({
      items: [{ id: 'prod_abc', quantity: 1 }],
      methods: ['CARD'],
      externalId: ORDER,
      returnUrl: `https://learn.example.com/checkout/pedido/${ORDER}`,
      completionUrl: `https://learn.example.com/checkout/pedido/${ORDER}`,
      card: { maxInstallments: 12 },
      metadata: { orderId: ORDER, courseId: COURSE.id },
    });

    const [save] = of('service', 'orders', 'update');
    expect(argsOf(save!, 'update')[0]![0]).toMatchObject({
      provider_billing_id: BILL,
      checkout_url: PAY_URL,
    });
    expect(argsOf(save!, 'eq')).toEqual([
      ['id', ORDER],
      ['status', 'pending'],
    ]);
  });

  it('produto já existe → não cria outro; parcelas limitadas a R$ 10 cada', async () => {
    getPublishedCourse.mockResolvedValue({ ...COURSE, priceCents: 2990 });
    fetchMock
      .mockResolvedValueOnce(json({ ...product, data: { ...product.data, price: 2990 } }))
      .mockResolvedValueOnce(json(checkout({ amount: 2990 })));
    await run(cardInput);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pathOf(1)).toBe('/v2/checkouts/create');
    expect(bodyOf(1).card).toEqual({ maxInstallments: 2 });
  });

  it.each([
    ['valor do checkout ≠ pedido', checkout({ amount: 100 })],
    ['URL fora da AbacatePay', checkout({ url: 'https://evil.dev/pay/bill_abc123xyz' })],
    ['checkout de outro pedido', checkout({ externalId: OTHER_ORDER })],
  ])('%s → pedido failed, sem redirect', async (_name, body) => {
    fetchMock.mockResolvedValueOnce(json(product)).mockResolvedValueOnce(json(body));
    const { result, redirectTo } = await run(cardInput);
    expect(redirectTo).toBeNull();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('cartão') });
    const [fail] = of('service', 'orders', 'update');
    expect(argsOf(fail!, 'update')[0]![0]).toEqual({ status: 'failed' });
  });

  it('produto editado no painel com outro preço → não cria checkout', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...product, data: { ...product.data, price: 1 } }));
    const { result } = await run(cardInput);
    expect(result).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reaproveita checkout de cartão pendente válido (redirect direto para a URL salva)', async () => {
    responses['user.orders.select'] = [
      {
        data: {
          id: OTHER_ORDER,
          expires_at: inMinutes(30),
          pix_br_code: null,
          checkout_url: PAY_URL,
          payment_method: 'card',
          created_at: agoMinutes(5),
        },
        error: null,
      },
    ];
    const { redirectTo } = await run(cardInput);
    expect(redirectTo).toBe(PAY_URL);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(of('service', 'orders', 'insert')).toHaveLength(0);
  });

  it('trocar de método: PIX pendente válido vira expired e nasce o pedido de cartão', async () => {
    responses['user.orders.select'] = [
      {
        data: {
          id: OTHER_ORDER,
          expires_at: inMinutes(30),
          pix_br_code: '000201',
          checkout_url: null,
          payment_method: 'pix',
          created_at: agoMinutes(5),
        },
        error: null,
      },
    ];
    fetchMock.mockResolvedValueOnce(json(product)).mockResolvedValueOnce(json(checkout()));
    const { redirectTo } = await run(cardInput);
    expect(redirectTo).toBe(PAY_URL);
    const [expire] = of('service', 'orders', 'update');
    expect(argsOf(expire!, 'update')[0]![0]).toEqual({ status: 'expired' });
  });

  it('método inválido → erro de validação, nada no banco', async () => {
    const { result } = await run({ ...cardInput, paymentMethod: 'boleto' });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});
