import { expect, test } from '@playwright/test';

import { createPublishedCourse } from './support/service';
import { expectNoHorizontalOverflow, visibleLink, visit } from './support/ui';

test.describe('visitante', () => {
  test('landing → catálogo → página do curso → comprar leva a /entrar', async ({ page }) => {
    const course = await createPublishedCourse({ priceCents: 12900 });

    await visit(page, '/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aprenda a criar jogos');

    await visibleLink(page, 'Ver cursos').click();
    await expect(page).toHaveURL(/\/cursos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cursos de game dev' })).toBeVisible();
    await expectNoHorizontalOverflow(page, '/cursos');

    // /cursos fica em cache (ISR): um curso inserido direto no banco, como esta fixture, só
    // entra na listagem quando o admin salva (revalidatePath, coberto em admin-course.spec)
    // ou após 5 min. A página do curso é gerada na primeira visita.
    await visit(page, `/cursos/${course.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: course.title })).toBeVisible();
    // O preço aparece no card lateral (desktop) e na barra fixa (celular): vale o visível.
    await expect(page.getByText('R$').locator('visible=true').first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `/cursos/${course.slug}`);

    // Visitante: "Comprar" leva ao cadastro e, depois dele, direto para a compra.
    await visibleLink(page, 'Comprar').click();
    await expect(page).toHaveURL(/\/cadastro\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/checkout/${course.slug}`);
    await expect(page.locator('form').getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      `/entrar?next=${encodeURIComponent(`/checkout/${course.slug}`)}`,
    );
    await expectNoHorizontalOverflow(page, '/cadastro');
  });

  test('telas públicas não rolam na horizontal', async ({ page }) => {
    for (const path of [
      '/',
      '/cursos',
      '/entrar',
      '/cadastro',
      '/recuperar-senha',
      '/termos',
      '/privacidade',
    ]) {
      await visit(page, path);
    }
  });

  test('rota inexistente mostra o 404 de marca', async ({ page }) => {
    const response = await page.goto('/esta-rota-nao-existe-e2e');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await expectNoHorizontalOverflow(page, '404');
    await expect(page.getByRole('link', { name: 'Ir para o início' })).toBeVisible();
  });
});
