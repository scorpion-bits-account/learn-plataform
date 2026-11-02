import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { billingIdOf, payCardCheckout, sendCheckoutWebhook } from './support/payments';
import {
  activeEnrollmentCount,
  createPublishedCourse,
  createUser,
  findOrderIdByBilling,
  getOrder,
} from './support/service';
import type { TestCourse } from './support/service';
import { expectNoHorizontalOverflow, signIn, visibleLink, visit } from './support/ui';

/**
 * Compra com cartão pelo checkout hospedado (PAY-007, ADR-022), contra o mock da
 * AbacatePay: o app cria o produto espelho e o checkout e redireciona para a
 * página de pagamento do mock (`/pay/<bill_…>`, o "app.abacatepay.com" dos testes).
 */
async function startCardPurchase(page: Page, course: TestCourse): Promise<string> {
  await visit(page, `/cursos/${course.slug}`);
  await visibleLink(page, /^Comprar$/).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${course.slug}$`));

  await page.getByRole('radio', { name: /Cartão de crédito/ }).check();
  // Cartão não pede CPF/celular aqui: o titular digita tudo na AbacatePay.
  await expect(page.getByLabel(/^CPF/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 'checkout (cartão)');
  await page.getByRole('button', { name: 'Pagar com cartão' }).click();

  await expect(page).toHaveURL(/\/pay\/bill_[0-9a-f]+$/);
  await expect(page.getByRole('button', { name: 'Pagar com cartão de teste' })).toBeVisible();
  const billingId = page.url().split('/').pop()!;
  return billingId;
}

test.describe('compra com cartão (checkout hospedado, mock da AbacatePay)', () => {
  test('redirect → paga no checkout → webhook checkout.completed → acesso', async ({ page }) => {
    const student = await createUser({ prefix: 'card' });
    const course = await createPublishedCourse({ priceCents: 4990, lessonCount: 1 });

    await signIn(page, student);
    const billingId = await startCardPurchase(page, course);

    // Pedido de cartão gravado com o checkout do provedor (sai da página do mock).
    await visit(page, '/minha-biblioteca');
    const orderId = await orderIdOf(billingId);
    expect(await billingIdOf(orderId)).toBe(billingId);
    const order = await getOrder(orderId);
    expect(order.payment_method).toBe('card');
    expect(order.amount_cents).toBe(4990);

    await payCardCheckout(billingId);

    const res = await sendCheckoutWebhook(orderId, billingId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, result: 'fulfilled' });
    expect((await getOrder(orderId)).status).toBe('paid');
    expect(await activeEnrollmentCount(student.id, course.id)).toBe(1);

    // Reentrega idempotente.
    expect((await sendCheckoutWebhook(orderId, billingId)).status).toBe(200);
    expect(await activeEnrollmentCount(student.id, course.id)).toBe(1);

    await visit(page, `/checkout/pedido/${orderId}`);
    await expect(page.getByText('Pagamento confirmado!')).toBeVisible();
    await expect(page.getByText('Cartão de crédito')).toBeVisible();
  });

  test('plano B: volta do checkout sem webhook e o polling reconsulta checkouts/get', async ({
    page,
  }) => {
    const student = await createUser({ prefix: 'cardpoll' });
    const course = await createPublishedCourse({ priceCents: 9900, lessonCount: 1 });

    await signIn(page, student);
    await startCardPurchase(page, course);

    // O botão do mock marca PAID e volta para o completionUrl (/checkout/pedido/<id>).
    await page.getByRole('button', { name: 'Pagar com cartão de teste' }).click();
    await expect(page).toHaveURL(/\/checkout\/pedido\/[0-9a-f-]{36}$/);
    const orderId = page.url().split('/').pop()!;
    await expect(page.getByText('Pagamento confirmado!')).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page, 'pedido pago (cartão)');
    expect((await getOrder(orderId)).status).toBe('paid');
    expect(await activeEnrollmentCount(student.id, course.id)).toBe(1);
  });

  test('webhook checkout.completed sem pagamento no provedor não libera (reconsulta)', async ({
    page,
  }) => {
    const student = await createUser({ prefix: 'cardforged' });
    const course = await createPublishedCourse({ lessonCount: 1 });

    await signIn(page, student);
    const billingId = await startCardPurchase(page, course);
    await visit(page, '/minha-biblioteca');
    const orderId = await orderIdOf(billingId);

    const forged = await sendCheckoutWebhook(orderId, billingId);
    expect(forged.status).toBe(503); // checkouts/get = PENDING → re-tentar
    expect((await getOrder(orderId)).status).toBe('pending');
    expect(await activeEnrollmentCount(student.id, course.id)).toBe(0);
  });
});

/** O app grava `provider_billing_id` antes do redirect; ainda assim espera o banco. */
async function orderIdOf(billingId: string): Promise<string> {
  let id: string | null = null;
  await expect
    .poll(async () => (id = await findOrderIdByBilling(billingId)), {
      message: 'pedido com o checkout gravado',
    })
    .toBeTruthy();
  return id!;
}
