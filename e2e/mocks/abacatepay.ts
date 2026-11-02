import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mock mínimo da AbacatePay API v2 (Checkout Transparente PIX + checkout hospedado de
 * cartão, PAY-007) para os testes E2E (ADR-021).
 *
 * O app aponta para ele com `ABACATEPAY_API_BASE_URL=http://127.0.0.1:<porta>/v2`.
 * Implementa só o que o app usa (docs/payments.md §2, §3, §8):
 *   POST /v2/transparents/create            -> cobrança `PENDING`
 *   GET  /v2/transparents/check?id=         -> status atual
 *   POST /v2/transparents/refund            -> `PAID` -> `REFUNDED`
 *   POST /v2/transparents/simulate-payment  -> `PENDING` -> `PAID` (o "pagar" do Dev mode)
 *   GET  /v2/products/get?externalId=       -> produto ou 404 (docs/payments.md §10.1)
 *   POST /v2/products/create                -> produto avulso (externalId único)
 *   POST /v2/checkouts/create               -> checkout `PENDING` com `url` = `<mock>/pay/<bill_…>`
 *   GET  /v2/checkouts/get?id=              -> status, amount, paidAmount, externalId
 *   POST /v2/checkouts/refund               -> `PAID` -> `REFUNDED`
 * Checkout hospedado simulado (fora de /v2, como `app.abacatepay.com/pay/…`):
 *   GET  /pay/<bill_…>  -> página com "Pagar com cartão de teste"
 *   POST /pay/<bill_…>  -> `PAID` e redirect 303 para o `completionUrl`
 * Extras só do mock (fora de /v2): `GET /__health`, `GET /__charges` e `GET /__checkouts`.
 *
 * Exige `Authorization: Bearer …` (qualquer valor não vazio) e valida o corpo do `create`,
 * então um bug de contrato no app (campo faltando, valor errado) falha o teste em vez de passar.
 * Sem dependências: só `node:http`. O estado fica em memória.
 */

export type MockPixStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'REFUNDED';

export interface MockCharge {
  id: string;
  amount: number;
  status: MockPixStatus;
  externalId: string | null;
  brCode: string;
  createdAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
}

/** PNG 1x1 transparente (o app só exige um data URL de imagem raster em base64). */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export type MockCheckoutStatus = 'PENDING' | 'PAID' | 'REFUNDED';

export interface MockProduct {
  id: string;
  externalId: string;
  name: string;
  price: number;
}

export interface MockCheckout {
  id: string;
  amount: number;
  status: MockCheckoutStatus;
  externalId: string | null;
  methods: string[];
  maxInstallments: number | null;
  completionUrl: string | null;
  returnUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AbacatePayMock {
  /** Sobe em `port` (0 = porta livre) no loopback e devolve a base `http://127.0.0.1:<porta>/v2`. */
  start(port?: number): Promise<{ port: number; baseUrl: string }>;
  stop(): Promise<void>;
  /** Cobranças em memória (somente leitura, para asserts em testes do mock). */
  charges(): readonly MockCharge[];
  /** Checkouts de cartão em memória. */
  checkouts(): readonly MockCheckout[];
  /** Produtos espelho em memória. */
  products(): readonly MockProduct[];
  reset(): void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

const ok = (data: unknown) => ({ data, success: true, error: null });
const fail = (error: string) => ({ data: null, success: false, error });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 64 * 1024) throw new Error('payload too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function publicCharge(charge: MockCharge) {
  return {
    id: charge.id,
    amount: charge.amount,
    status: charge.status,
    devMode: true,
    brCode: charge.brCode,
    brCodeBase64: PIXEL_PNG,
    platformFee: 80,
    receiptUrl: null,
    createdAt: charge.createdAt,
    updatedAt: new Date().toISOString(),
    expiresAt: charge.expiresAt,
    metadata: charge.metadata,
  };
}

/** Aplica a expiração "preguiçosa": PIX vencido e não pago vira `EXPIRED` ao ser consultado. */
function refreshExpiry(charge: MockCharge): void {
  if (charge.status === 'PENDING' && Date.parse(charge.expiresAt) <= Date.now()) {
    charge.status = 'EXPIRED';
  }
}

function publicCheckout(checkout: MockCheckout, origin: string) {
  return {
    id: checkout.id,
    externalId: checkout.externalId,
    url: `${origin}/pay/${checkout.id}`,
    amount: checkout.amount,
    paidAmount: checkout.status === 'PENDING' ? null : checkout.amount,
    status: checkout.status,
    frequency: 'ONE_TIME',
    methods: checkout.methods,
    card: checkout.maxInstallments ? { maxInstallments: checkout.maxInstallments } : null,
    devMode: true,
    returnUrl: checkout.returnUrl,
    completionUrl: checkout.completionUrl,
    metadata: checkout.metadata,
    createdAt: checkout.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function createAbacatePayMock(): AbacatePayMock {
  const store = new Map<string, MockCharge>();
  const productStore = new Map<string, MockProduct>();
  const checkoutStore = new Map<string, MockCheckout>();
  let server: Server | undefined;
  let origin = 'http://127.0.0.1';

  function createProduct(body: unknown, res: ServerResponse): void {
    if (!isRecord(body)) return sendJson(res, 400, fail('JSON inválido'));
    const { externalId, name, price, currency } = body;
    if (!isNonEmptyString(externalId) || !isNonEmptyString(name) || currency !== 'BRL') {
      return sendJson(res, 400, fail('externalId, name e currency BRL são obrigatórios'));
    }
    if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0) {
      return sendJson(res, 400, fail('price must be a positive integer (cents)'));
    }
    if ([...productStore.values()].some((p) => p.externalId === externalId)) {
      return sendJson(res, 400, fail('Já existe um produto com este externalId'));
    }
    const product: MockProduct = {
      id: `prod_${randomBytes(9).toString('hex')}`,
      externalId,
      name,
      price,
    };
    productStore.set(product.id, product);
    sendJson(res, 200, ok({ ...product, currency: 'BRL', devMode: true, status: 'ACTIVE' }));
  }

  function createCheckout(body: unknown, res: ServerResponse): void {
    if (!isRecord(body) || !Array.isArray(body.items) || body.items.length !== 1) {
      return sendJson(res, 400, fail('items com exatamente 1 produto é obrigatório'));
    }
    const item = body.items[0] as unknown;
    const product =
      isRecord(item) && typeof item.id === 'string' ? productStore.get(item.id) : undefined;
    if (!product || !isRecord(item) || item.quantity !== 1) {
      return sendJson(res, 400, fail('Produto não encontrado'));
    }
    const { methods, externalId, returnUrl, completionUrl, card, metadata } = body;
    if (!Array.isArray(methods) || methods.length === 0) {
      return sendJson(res, 400, fail('methods é obrigatório'));
    }
    if (externalId !== undefined && !isNonEmptyString(externalId)) {
      return sendJson(res, 400, fail('externalId must be a non-empty string'));
    }
    if (
      (returnUrl !== undefined && !isHttpUrl(returnUrl)) ||
      (completionUrl !== undefined && !isHttpUrl(completionUrl))
    ) {
      return sendJson(res, 400, fail('returnUrl/completionUrl inválidas'));
    }
    let maxInstallments: number | null = null;
    if (card !== undefined) {
      const max = isRecord(card) ? card.maxInstallments : undefined;
      if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 12) {
        return sendJson(res, 400, fail('card.maxInstallments deve ser 1–12'));
      }
      if (product.price < max * 1000) {
        return sendJson(res, 400, fail(`Total below minimum for ${max}x (R$10 per installment)`));
      }
      maxInstallments = max;
    }
    const checkout: MockCheckout = {
      id: `bill_${randomBytes(9).toString('hex')}`,
      amount: product.price,
      status: 'PENDING',
      externalId: typeof externalId === 'string' ? externalId : null,
      methods: methods.map(String),
      maxInstallments,
      returnUrl: typeof returnUrl === 'string' ? returnUrl : null,
      completionUrl: typeof completionUrl === 'string' ? completionUrl : null,
      metadata: isRecord(metadata) ? metadata : {},
      createdAt: new Date().toISOString(),
    };
    checkoutStore.set(checkout.id, checkout);
    sendJson(res, 200, ok(publicCheckout(checkout, origin)));
  }

  /** Página do checkout hospedado (só o essencial para o E2E "pagar" e voltar). */
  function payPage(checkout: MockCheckout, res: ServerResponse): void {
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AbacatePay (mock)</title></head><body><main><h1>Checkout AbacatePay (mock)</h1><p>Total: ${checkout.amount} centavos · ${escapeHtml(checkout.status)}</p><form method="post"><button type="submit">Pagar com cartão de teste</button></form></main></body></html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
    });
    res.end(html);
  }

  function create(body: unknown, res: ServerResponse): void {
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    if (!isRecord(body) || body.method !== 'PIX' || !data) {
      return sendJson(res, 400, fail('method must be PIX and data is required'));
    }
    const { amount, externalId, expiresIn, customer, metadata } = data;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return sendJson(res, 400, fail('data.amount must be a positive integer (cents)'));
    }
    if (externalId !== undefined && !isNonEmptyString(externalId)) {
      return sendJson(res, 400, fail('data.externalId must be a non-empty string'));
    }
    if (
      expiresIn !== undefined &&
      (typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn <= 0)
    ) {
      return sendJson(res, 400, fail('data.expiresIn must be a positive integer (seconds)'));
    }
    if (customer !== undefined) {
      const valid =
        isRecord(customer) &&
        isNonEmptyString(customer.name) &&
        isNonEmptyString(customer.email) &&
        isNonEmptyString(customer.taxId) &&
        isNonEmptyString(customer.cellphone);
      if (!valid) {
        return sendJson(res, 400, fail('data.customer needs name, email, taxId and cellphone'));
      }
    }

    const now = Date.now();
    const id = `pix_char_${randomBytes(9).toString('hex')}`;
    const charge: MockCharge = {
      id,
      amount,
      status: 'PENDING',
      externalId: typeof externalId === 'string' ? externalId : null,
      brCode: `00020126580014BR.GOV.BCB.PIX0136e2e-mock-${id}5204000053039865802BR5909E2E MOCK6009SAO PAULO62070503***6304ABCD`,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(
        now + (typeof expiresIn === 'number' ? expiresIn : 86_400) * 1000,
      ).toISOString(),
      metadata: isRecord(metadata) ? metadata : {},
    };
    store.set(id, charge);
    sendJson(res, 200, ok(publicCharge(charge)));
  }

  function find(id: string | null, res: ServerResponse): MockCharge | null {
    const charge = id ? store.get(id) : undefined;
    if (!charge) {
      sendJson(res, 404, fail('Cobrança não encontrada'));
      return null;
    }
    refreshExpiry(charge);
    return charge;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://mock.local');
    const method = req.method ?? 'GET';

    if (url.pathname === '/__health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/__charges' && method === 'GET') {
      store.forEach(refreshExpiry);
      return sendJson(res, 200, [...store.values()]);
    }
    if (url.pathname === '/__checkouts' && method === 'GET') {
      return sendJson(res, 200, [...checkoutStore.values()]);
    }

    // Checkout hospedado simulado (o "app.abacatepay.com/pay/…" do mock): sem chave de API.
    const pay = /^\/pay\/(bill_[a-f0-9]+)$/.exec(url.pathname);
    if (pay) {
      const checkout = checkoutStore.get(pay[1]!);
      if (!checkout) return sendJson(res, 404, fail('Checkout não encontrado'));
      if (method === 'GET') return payPage(checkout, res);
      if (method === 'POST') {
        if (checkout.status === 'PENDING') checkout.status = 'PAID';
        res.writeHead(303, {
          Location: checkout.completionUrl ?? '/',
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
    }

    if (!url.pathname.startsWith('/v2/')) {
      return sendJson(res, 404, fail('Rota inexistente'));
    }
    const bearer = /^Bearer\s+\S+$/.test(req.headers.authorization ?? '');
    if (!bearer) return sendJson(res, 401, fail('Chave de API ausente ou inválida'));

    let body: unknown = {};
    if (method === 'POST') {
      try {
        body = await readJson(req);
      } catch {
        return sendJson(res, 400, fail('JSON inválido'));
      }
    }

    if (url.pathname === '/v2/products/get' && method === 'GET') {
      const externalId = url.searchParams.get('externalId');
      const product = [...productStore.values()].find((p) => p.externalId === externalId);
      if (!product) return sendJson(res, 404, fail('Produto não encontrado.'));
      return sendJson(
        res,
        200,
        ok({ ...product, currency: 'BRL', devMode: true, status: 'ACTIVE' }),
      );
    }
    if (url.pathname === '/v2/products/create' && method === 'POST')
      return createProduct(body, res);
    if (url.pathname === '/v2/checkouts/create' && method === 'POST') {
      return createCheckout(body, res);
    }
    if (url.pathname === '/v2/checkouts/get' && method === 'GET') {
      const checkout = checkoutStore.get(url.searchParams.get('id') ?? '');
      if (!checkout) return sendJson(res, 404, fail('Checkout não encontrado'));
      return sendJson(res, 200, ok(publicCheckout(checkout, origin)));
    }
    if (url.pathname === '/v2/checkouts/refund' && method === 'POST') {
      const id = isRecord(body) && typeof body.id === 'string' ? body.id : '';
      const checkout = checkoutStore.get(id);
      if (!checkout) return sendJson(res, 404, fail('TRANSACTION_NOT_FOUND'));
      if (checkout.status === 'REFUNDED') {
        return sendJson(res, 400, fail('Esta cobrança já foi reembolsada.'));
      }
      if (checkout.status !== 'PAID') return sendJson(res, 400, fail('TRANSACTION_NOT_REFUNDABLE'));
      checkout.status = 'REFUNDED';
      return sendJson(
        res,
        200,
        ok({
          id: `tran_${randomBytes(6).toString('hex')}`,
          status: 'COMPLETE',
          amount: checkout.amount,
          originalId: id,
        }),
      );
    }

    if (!url.pathname.startsWith('/v2/transparents/')) {
      return sendJson(res, 404, fail('Rota inexistente'));
    }
    const route = url.pathname.slice('/v2/transparents/'.length);

    if (route === 'create' && method === 'POST') return create(body, res);

    if (route === 'check' && method === 'GET') {
      const charge = find(url.searchParams.get('id'), res);
      if (!charge) return;
      // Como a API real: o `check` devolve só id, status e expiresAt.
      return sendJson(
        res,
        200,
        ok({ id: charge.id, status: charge.status, expiresAt: charge.expiresAt }),
      );
    }

    if (route === 'simulate-payment' && method === 'POST') {
      const fromBody = isRecord(body) && typeof body.id === 'string' ? body.id : null;
      const charge = find(url.searchParams.get('id') ?? fromBody, res);
      if (!charge) return;
      if (charge.status !== 'PENDING') {
        return sendJson(res, 400, fail(`Cobrança ${charge.status} não pode ser paga`));
      }
      charge.status = 'PAID';
      return sendJson(res, 200, ok(publicCharge(charge)));
    }

    if (route === 'refund' && method === 'POST') {
      const id = isRecord(body) && typeof body.id === 'string' ? body.id : null;
      const charge = find(id, res);
      if (!charge) return;
      if (charge.status === 'REFUNDED') {
        return sendJson(res, 400, fail('Esta cobrança já foi reembolsada.'));
      }
      if (charge.status !== 'PAID') {
        return sendJson(res, 400, fail('TRANSACTION_NOT_REFUNDABLE'));
      }
      charge.status = 'REFUNDED';
      return sendJson(res, 200, ok(publicCharge(charge)));
    }

    return sendJson(res, 404, fail('Rota inexistente'));
  }

  return {
    async start(port = 0) {
      if (server) throw new Error('mock já iniciado');
      const instance = createServer((req, res) => {
        handle(req, res).catch(() => sendJson(res, 500, fail('erro interno do mock')));
      });
      await new Promise<void>((resolve, reject) => {
        instance.once('error', reject);
        instance.listen(port, '127.0.0.1', () => resolve());
      });
      server = instance;
      const actual = (instance.address() as AddressInfo).port;
      origin = `http://127.0.0.1:${actual}`;
      return { port: actual, baseUrl: `${origin}/v2` };
    },
    async stop() {
      const instance = server;
      server = undefined;
      if (!instance) return;
      await new Promise<void>((resolve) => {
        instance.close(() => resolve());
        instance.closeAllConnections();
      });
    },
    charges: () => [...store.values()],
    checkouts: () => [...checkoutStore.values()],
    products: () => [...productStore.values()],
    reset: () => {
      store.clear();
      checkoutStore.clear();
      productStore.clear();
    },
  };
}
