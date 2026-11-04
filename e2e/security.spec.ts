import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { loadE2eEnv } from './support/env';
import { createPublishedCourse, createUser } from './support/service';
import { expectNoHorizontalOverflow, signIn } from './support/ui';

test.describe('segurança básica', () => {
  test('aluno em /admin é bloqueado; anônimo vai para o login', async ({ page }) => {
    const student = await createUser({ prefix: 'nonadmin' });

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fadmin/);

    await signIn(page, student);
    for (const path of ['/admin', '/admin/cursos', '/admin/alunos', '/admin/pedidos']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { name: /não encontrad/i })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
    }
    await expectNoHorizontalOverflow(page, '404 de /admin');
  });

  test('aula paga sem acesso não mostra o material (nem no HTML, nem pela API)', async ({
    page,
  }) => {
    const student = await createUser({ prefix: 'noaccess' });
    const course = await createPublishedCourse({ lessonCount: 2, isPreview: true });
    const [preview, paid] = course.lessons as [
      (typeof course.lessons)[number],
      (typeof course.lessons)[number],
    ];

    await signIn(page, student);

    // Aula paga: sem material no DOM nem no HTML/RSC enviado.
    await page.goto(`/aprender/${course.slug}/${paid.id}`);
    await expect(page.getByText(paid.body)).toHaveCount(0);
    expect(await page.content()).not.toContain(paid.body);
    await expect(
      page.getByText(/faz parte do curso completo|Página não encontrada/).first(),
    ).toBeVisible();

    // Aula de prévia continua aberta (controle positivo: o teste não passa "no vazio").
    await page.goto(`/aprender/${course.slug}/${preview.id}`);
    await expect(page.getByText(preview.body)).toBeVisible();

    // RLS: a API pública (chave publishable, anônimo) não lê o material da aula paga.
    const env = loadE2eEnv();
    const anon = createClient(env.supabaseUrl, env.publishableKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon
      .from('lesson_materials')
      .select('id, body')
      .eq('lesson_id', paid.id);
    expect(data ?? []).toHaveLength(0);
  });

  test('visitante assiste à prévia sem login; aula paga leva a "você ainda não comprou"', async ({
    page,
  }) => {
    const course = await createPublishedCourse({ lessonCount: 2, isPreview: true });
    const [preview, paid] = course.lessons as [
      (typeof course.lessons)[number],
      (typeof course.lessons)[number],
    ];

    await page.goto(`/previa/${course.slug}/${preview.id}`);
    await expect(page.getByText(preview.body)).toBeVisible();
    await expectNoHorizontalOverflow(page, 'prévia sem login');

    await page.goto(`/previa/${course.slug}/${paid.id}`);
    await expect(page).toHaveURL(new RegExp(`/cursos/${course.slug}/acesso$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Você ainda não comprou este curso' }),
    ).toBeVisible();
    expect(await page.content()).not.toContain(paid.body);
    await expect(page.getByRole('link', { name: 'Criar conta e comprar' })).toHaveAttribute(
      'href',
      `/cadastro?next=${encodeURIComponent(`/checkout/${course.slug}`)}`,
    );
    await expectNoHorizontalOverflow(page, 'tela de acesso');
  });
});
