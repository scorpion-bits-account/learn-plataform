import { expect, test } from '@playwright/test';

import { COVER_PNG } from './support/assets';
import { createUser, getCourseByTitle, uid } from './support/service';
import { expectNoHorizontalOverflow, signIn, visit } from './support/ui';

test('admin cria curso, módulo, aula com texto, envia capa e publica; aparece no catálogo', async ({
  page,
}) => {
  const admin = await createUser({ prefix: 'admin', admin: true });
  const suffix = uid();
  const title = `Curso do admin ${suffix}`;
  const moduleTitle = `Módulo ${suffix}`;
  const lessonTitle = `Aula ${suffix}`;
  const lessonText = `Texto da aula ${suffix}`;

  await signIn(page, admin);
  await expect(page).toHaveURL(/\/admin/);
  await expectNoHorizontalOverflow(page, '/admin');

  await test.step('cria o curso (rascunho)', async () => {
    await visit(page, '/admin/cursos/novo');
    await page.getByLabel(/^Título/).fill(title);
    await page.getByLabel(/^Preço/).fill('49,90');
    await page.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page).toHaveURL(/\/admin\/cursos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'editar curso');
  });
  const courseUrl = page.url();
  const courseId = courseUrl.split('/').pop()!;

  await test.step('adiciona módulo e aula na ementa', async () => {
    await page.getByRole('tab', { name: 'Ementa' }).click();
    await page.getByLabel('Título do novo módulo').fill(moduleTitle);
    await page.getByRole('button', { name: 'Adicionar módulo' }).click();
    await expect(page.getByRole('list', { name: 'Módulos do curso' })).toContainText(moduleTitle);

    await page.getByLabel(`Título da nova aula em "${moduleTitle}"`).fill(lessonTitle);
    await page.getByRole('button', { name: 'Adicionar aula' }).click();
    await expect(
      page.getByRole('list', { name: `Aulas do módulo "${moduleTitle}"` }),
    ).toContainText(lessonTitle);
    await expectNoHorizontalOverflow(page, 'ementa');
  });

  await test.step('a aula nova já abre na ementa; adiciona o material de texto ali mesmo', async () => {
    // Criar a aula a abre expandida (estado na URL), sem sair da Ementa.
    await expect(page).toHaveURL(/tab=syllabus&aula=[0-9a-f-]{36}/);
    const toggle = page.getByRole('button', { name: `Materiais da aula "${lessonTitle}" (0)` });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Sem conteúdo ainda')).toBeVisible();

    await page.getByLabel('Tipo de material').selectOption({ label: 'Texto' });
    await page.getByLabel(/^Texto \(markdown\)/).fill(`${lessonText}\n\n## Bem-vindo`);
    await page.getByRole('button', { name: 'Adicionar material' }).click();
    await expect(page.getByRole('list', { name: 'Materiais da aula' })).toBeVisible();
    await expect(page.getByText(lessonText).first()).toBeVisible();
    // A ementa reflete na hora: contador e resumo.
    await expect(
      page.getByRole('button', { name: `Materiais da aula "${lessonTitle}" (1)` }),
    ).toBeVisible();
    await expect(page.getByText('1 texto', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'materiais da aula na ementa');
  });

  await test.step('a aula aberta sobrevive a recarregar; fechar remove da URL', async () => {
    await page.reload();
    const toggle = page.getByRole('button', { name: `Materiais da aula "${lessonTitle}" (1)` });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(lessonText).first()).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page).not.toHaveURL(/aula=/);
  });

  await test.step('envia a capa e salva', async () => {
    await visit(page, courseUrl.replace(/^https?:\/\/[^/]+/, ''));
    await page.locator('input[type="file"]').setInputFiles({
      name: 'capa-e2e.png',
      mimeType: 'image/png',
      buffer: COVER_PNG,
    });
    await expect(page.getByRole('button', { name: 'Trocar capa' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect
      .poll(async () => (await getCourseByTitle(title))?.cover_path ?? null, {
        message: 'cover_path gravado no curso',
      })
      .toMatch(new RegExp(`^courses/${courseId}/`));
  });

  await test.step('publica', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect
      .poll(async () => (await getCourseByTitle(title))?.status, {
        message: 'status do curso',
      })
      .toBe('published');
  });

  await test.step('curso publicado continua editável pela lista (botão Editar)', async () => {
    await visit(page, '/admin/cursos');
    await page.getByRole('link', { name: `Editar curso ${title}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/cursos/${courseId}$`));
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();
  });

  await test.step('aparece no catálogo público', async () => {
    const course = await getCourseByTitle(title);
    // Visitante (sem a sessão do admin).
    await page.context().clearCookies();
    await visit(page, '/cursos');
    await expect(page.getByRole('link', { name: title }).first()).toBeVisible();
    await page.getByRole('link', { name: title }).first().click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${course!.slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'curso publicado');
  });
});
