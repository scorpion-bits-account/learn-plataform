// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env/server', () => ({
  getPaymentsEnv: () => ({ ABACATEPAY_API_KEY: 'abc_dev_e2e', ABACATEPAY_WEBHOOK_SECRET: 's' }),
}));

import {
  createCardCheckout,
  createPixCharge,
  getCardCheckoutStatus,
  getPixStatus,
  refundCardCheckout,
  refundPixCharge,
} from '@/lib/payments/abacatepay';

import { createAbacatePayMock } from './abacatepay';

const mock = createAbacatePayMock();
let baseUrl = '';
const auth = { Authorization: 'Bearer abc_dev_e2e', 'Content-Type': 'application/json' };

const validBody = {
  method: 'PIX',
  data: {
    amount: 4990,
    description: 'Curso',
    expiresIn: 3600,
    externalId: 'order-1',
    customer: {
      name: 'Ana',
      email: 'ana@exemplo.com',
      taxId: '111.444.777-35',
      cellphone: '(11) 94002-8922',
    },
    metadata: { orderId: 'order-1' },
  },
};

beforeAll(async () => {
  baseUrl = (await mock.start(0)).baseUrl;
});
afterAll(async () => {
  await mock.stop();
});
beforeEach(() => {
  mock.reset();
  vi.stubEnv('ABACATEPAY_API_BASE_URL', baseUrl);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

describe('mock da AbacatePay', () => {
  it('exige Authorization', async () => {
    const res = await post('/transparents/create', validBody, {
      'Content-Type': 'application/json',
    });
    expect(res.status).toBe(401);
  });

  it('recusa criação inválida (valor, método, customer incompleto)', async () => {
    const bad = [
      { ...validBody, method: 'BOLETO' },
      { ...validBody, data: { ...validBody.data, amount: 0 } },
      { ...validBody, data: { ...validBody.data, amount: 10.5 } },
      { ...validBody, data: { ...validBody.data, customer: { name: 'Ana' } } },
    ];
    for (const body of bad) {
      expect((await post('/transparents/create', body)).status).toBe(400);
    }
  });

  it('cria, consulta, paga (simulate-payment) e reembolsa', async () => {
    const created = await (await post('/transparents/create', validBody)).json();
    expect(created.success).toBe(true);
    expect(created.data.status).toBe('PENDING');
    expect(created.data.id).toMatch(/^pix_char_/);
    const id = created.data.id as string;

    const pending = await (
      await fetch(`${baseUrl}/transparents/check?id=${id}`, { headers: auth })
    ).json();
    expect(pending.data).toMatchObject({ id, status: 'PENDING' });

    expect((await post('/transparents/refund', { id })).status).toBe(400); // ainda não paga

    const paid = await post(`/transparents/simulate-payment?id=${id}`, {});
    expect(paid.status).toBe(200);
    expect((await paid.json()).data.status).toBe('PAID');
    expect((await post(`/transparents/simulate-payment?id=${id}`, {})).status).toBe(400);

    const checked = await (
      await fetch(`${baseUrl}/transparents/check?id=${id}`, { headers: auth })
    ).json();
    expect(checked.data.status).toBe('PAID');

    expect((await post('/transparents/refund', { id, reason: 'teste' })).status).toBe(200);
    const again = await post('/transparents/refund', { id });
    expect(again.status).toBe(400);
    expect(JSON.stringify(await again.json())).toContain('já foi reembolsada');
  });

  it('check de id desconhecido é 404', async () => {
    const res = await fetch(`${baseUrl}/transparents/check?id=pix_char_nope`, { headers: auth });
    expect(res.status).toBe(404);
  });

  it('expira o PIX vencido ao consultar', async () => {
    const body = { ...validBody, data: { ...validBody.data, expiresIn: 1 } };
    const { data } = await (await post('/transparents/create', body)).json();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const checked = await (
      await fetch(`${baseUrl}/transparents/check?id=${data.id}`, { headers: auth })
    ).json();
    expect(checked.data.status).toBe('EXPIRED');
  });
});

describe('cliente real do app contra o mock', () => {
  it('createPixCharge -> getPixStatus -> simulate-payment -> PAID -> refund', async () => {
    const charge = await createPixCharge({
      orderId: 'order-42',
      amountCents: 19700,
      description: 'Curso: Godot',
      customer: {
        name: 'Ana',
        email: 'ana@exemplo.com',
        taxId: '11144477735',
        cellphone: '11940028922',
      },
      expiresInSeconds: 3600,
      metadata: { courseId: 'c1' },
    });
    expect(charge.status).toBe('PENDING');
    expect(charge.brCode.length).toBeGreaterThan(10);
    expect(charge.brCodeBase64).toMatch(/^data:image\/png;base64,/);
    expect(mock.charges()[0]).toMatchObject({ externalId: 'order-42', amount: 19700 });

    expect((await getPixStatus(charge.billingId)).status).toBe('PENDING');
    await post(`/transparents/simulate-payment?id=${charge.billingId}`, {});
    expect((await getPixStatus(charge.billingId)).status).toBe('PAID');
    expect(await refundPixCharge(charge.billingId)).toEqual({ alreadyRefunded: false });
    expect(await refundPixCharge(charge.billingId)).toEqual({ alreadyRefunded: true });
  });
});

describe('mock — checkout hospedado de cartão (PAY-007)', () => {
  const ORDER = '11111111-1111-4111-8111-111111111111';
  const input = {
    orderId: ORDER,
    courseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    amountCents: 4990,
    productName: 'Curso',
    maxInstallments: 4,
    returnUrl: `http://127.0.0.1:3000/checkout/pedido/${ORDER}`,
  };

  it('cliente real do app: produto espelho → checkout → pagar na página → PAID → reembolso', async () => {
    const created = await createCardCheckout(input);
    expect(created.url).toBe(`${baseUrl.replace('/v2', '')}/pay/${created.billingId}`);
    expect(mock.products()).toHaveLength(1);

    // Segundo checkout do mesmo curso/preço reaproveita o produto.
    await createCardCheckout({ ...input, orderId: '22222222-2222-4222-8222-222222222222' });
    expect(mock.products()).toHaveLength(1);

    expect((await getCardCheckoutStatus(created.billingId)).status).toBe('PENDING');

    const page = await fetch(created.url);
    expect(await page.text()).toContain('Pagar com cartão de teste');
    const paid = await fetch(created.url, { method: 'POST', redirect: 'manual' });
    expect(paid.status).toBe(303);
    expect(paid.headers.get('location')).toBe(input.returnUrl);

    expect(await getCardCheckoutStatus(created.billingId)).toMatchObject({
      status: 'PAID',
      amountCents: 4990,
      paidAmountCents: 4990,
      externalId: ORDER,
    });
    expect(await refundCardCheckout(created.billingId)).toEqual({ alreadyRefunded: false });
    expect(await refundCardCheckout(created.billingId)).toEqual({ alreadyRefunded: true });
    expect((await getCardCheckoutStatus(created.billingId)).status).toBe('REFUNDED');
  });

  it('recusa parcela abaixo de R$ 10 e rotas de API sem chave', async () => {
    await expect(createCardCheckout({ ...input, maxInstallments: 12 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const res = await fetch(`${baseUrl}/checkouts/get?id=bill_x`);
    expect(res.status).toBe(401);
  });
});
