import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

class NotFoundError extends Error {}
const requireAdmin = vi.fn();
vi.mock('@/lib/auth/dal', () => ({
  requireAdmin: () => requireAdmin(),
  requireUser: vi.fn(),
}));

// Builder encadeável e "thenable"; cada tabela/operação pode ter seu próprio resultado.
type Result = { data: unknown; error: unknown };
let results: Record<string, Result>;
let fallback: Result;
const calls: { table: string; op: string; arg?: unknown }[] = [];
const rpc = vi.fn<(...args: unknown[]) => Promise<Result>>(async () => ({
  data: null,
  error: null,
}));
const remove = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  data: null,
  error: null,
}));

function builder(table: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  for (const name of ['insert', 'update', 'delete', 'select', 'eq', 'order', 'limit']) {
    b[name] = (arg?: unknown) => {
      if (['insert', 'update', 'delete'].includes(name)) op = name;
      calls.push({ table, op: name, arg });
      return b;
    };
  }
  const resolve = () => results[`${table}.${op}`] ?? fallback;
  b.single = () => Promise.resolve(resolve());
  b.maybeSingle = () => Promise.resolve(resolve());
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(res, rej);
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => builder(t),
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: (bucket: string) => ({ remove: (p: string[]) => remove(bucket, p) }) },
  })),
}));

import {
  createMaterial,
  deleteMaterial,
  discardUpload,
  reorderMaterials,
  updateMaterial,
} from './actions';

const COURSE = '11111111-1111-4111-8111-111111111111';
const LESSON = '33333333-3333-4333-8333-333333333333';
const MATERIAL = '44444444-4444-4444-8444-444444444444';
const OTHER = '99999999-9999-4999-8999-999999999999';
const UUID = '0b0e2d5a-1111-4222-8333-444455556666';
const UUID2 = '1c1f3e6b-2222-4333-8444-555566667777';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PATH = `${COURSE}/${LESSON}/${UUID}-projeto.zip`;
const NEW_PATH = `${COURSE}/${LESSON}/${UUID2}-novo.zip`;
const file = (storagePath: string) => ({
  storagePath,
  fileName: 'projeto.zip',
  fileSize: 1234,
  mimeType: 'application/zip',
});

const find = (table: string, op: string) => calls.find((c) => c.table === table && c.op === op);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  results = {
    'lessons.select': { data: { id: LESSON, course_id: COURSE }, error: null },
    'lesson_materials.select': { data: [{ position: 2 }], error: null },
    'lesson_materials.insert': { data: { id: MATERIAL }, error: null },
  };
  fallback = { data: { id: MATERIAL }, error: null };
  requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'a@b.c' });
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('autorização', () => {
  it('não-admin é rejeitado antes de ler o input ou tocar no banco/storage', async () => {
    requireAdmin.mockRejectedValue(new NotFoundError('notFound'));
    const attempts = [
      createMaterial({ type: 'text', lessonId: LESSON, body: 'x' }),
      updateMaterial({ type: 'text', id: MATERIAL, body: 'x' }),
      deleteMaterial({ id: MATERIAL }),
      reorderMaterials({ lessonId: LESSON, ids: [A] }),
      discardUpload({ lessonId: LESSON, storagePath: PATH }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('validação', () => {
  it('ids que não são uuid e dados inválidos não chegam ao banco', async () => {
    expect(await createMaterial({ type: 'text', lessonId: 'abc', body: 'x' })).toMatchObject({
      ok: false,
    });
    expect(
      await createMaterial({
        type: 'link',
        lessonId: LESSON,
        title: 'x',
        url: 'javascript:alert(1)',
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { url: expect.any(Array) },
    });
    expect(
      await createMaterial({ type: 'link', lessonId: LESSON, title: ' ', url: 'https://a.dev' }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { title: expect.any(Array) },
    });
    expect(await deleteMaterial({ id: "1'; drop table lesson_materials;--" })).toMatchObject({
      ok: false,
    });
    expect(await reorderMaterials({ lessonId: LESSON, ids: [A, A] })).toMatchObject({ ok: false });
    expect(await reorderMaterials({ lessonId: LESSON, ids: [] })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('createMaterial', () => {
  it('video: extrai provider + id no servidor e anexa no fim', async () => {
    const result = await createMaterial({
      type: 'video',
      lessonId: LESSON,
      title: ' Intro ',
      url: 'https://youtu.be/dQw4w9WgXcQ?si=x',
    });
    expect(result).toEqual({ ok: true, data: { id: MATERIAL } });
    expect(find('lesson_materials', 'insert')?.arg).toEqual({
      lesson_id: LESSON,
      course_id: COURSE,
      title: 'Intro',
      show_in_all_lessons: false,
      type: 'video',
      video_provider: 'youtube',
      video_id: 'dQw4w9WgXcQ',
      position: 3,
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('video: URL de outro site é rejeitada sem inserir', async () => {
    for (const url of [
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://evil.com/x',
      'javascript:alert(1)',
    ]) {
      expect(await createMaterial({ type: 'video', lessonId: LESSON, url })).toMatchObject({
        ok: false,
        fieldErrors: { url: expect.any(Array) },
      });
    }
    expect(find('lesson_materials', 'insert')).toBeUndefined();
  });

  it('text e link gravam só os campos do próprio tipo', async () => {
    await createMaterial({ type: 'text', lessonId: LESSON, body: '# Oi' });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({
      type: 'text',
      body: '# Oi',
      title: null,
      position: 3,
    });
    expect(find('lesson_materials', 'insert')?.arg).not.toHaveProperty('external_url');

    calls.length = 0;
    await createMaterial({
      type: 'link',
      lessonId: LESSON,
      title: 'Docs',
      url: 'https://docs.dev/x',
    });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({
      type: 'link',
      title: 'Docs',
      external_url: 'https://docs.dev/x',
    });
  });

  it('grava show_in_all_lessons (padrão false)', async () => {
    await createMaterial({ type: 'text', lessonId: LESSON, body: 'x', showInAllLessons: true });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({ show_in_all_lessons: true });
    calls.length = 0;
    await createMaterial({ type: 'text', lessonId: LESSON, body: 'x' });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({ show_in_all_lessons: false });
    calls.length = 0;
    expect(
      await createMaterial({ type: 'text', lessonId: LESSON, body: 'x', showInAllLessons: 'sim' }),
    ).toMatchObject({ ok: false });
    expect(find('lesson_materials', 'insert')).toBeUndefined();
  });

  it('primeiro material da aula fica na posição 0', async () => {
    results['lesson_materials.select'] = { data: [], error: null };
    await createMaterial({ type: 'text', lessonId: LESSON, body: 'x' });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({ position: 0 });
  });

  it('file: grava metadados quando o caminho está sob <curso>/<aula>/', async () => {
    const result = await createMaterial({ type: 'file', lessonId: LESSON, file: file(PATH) });
    expect(result).toMatchObject({ ok: true });
    expect(find('lesson_materials', 'insert')?.arg).toMatchObject({
      type: 'file',
      storage_path: PATH,
      file_name: 'projeto.zip',
      file_size: 1234,
      mime_type: 'application/zip',
    });
  });

  it('file: caminho fora do prefixo (outro curso/aula, traversal, formato) é rejeitado', async () => {
    const bad = [
      `${OTHER}/${LESSON}/${UUID}-a.zip`,
      `${COURSE}/${OTHER}/${UUID}-a.zip`,
      `${COURSE}/${LESSON}/../${OTHER}/${UUID}-a.zip`,
      `/${COURSE}/${LESSON}/${UUID}-a.zip`,
      `${COURSE}/${LESSON}/a.zip`,
      'qualquer/coisa.zip',
    ];
    for (const storagePath of bad) {
      expect(
        await createMaterial({ type: 'file', lessonId: LESSON, file: file(storagePath) }),
      ).toMatchObject({
        ok: false,
        fieldErrors: { file: expect.any(Array) },
      });
    }
    expect(find('lesson_materials', 'insert')).toBeUndefined();
  });

  it('file: tamanho e mime inválidos são rejeitados no servidor', async () => {
    const attempt = (patch: object) =>
      createMaterial({ type: 'file', lessonId: LESSON, file: { ...file(PATH), ...patch } });
    expect(await attempt({ mimeType: 'application/pdf' })).toMatchObject({ ok: false });
    expect(await attempt({ mimeType: 'text/html' })).toMatchObject({ ok: false });
    expect(await attempt({ fileSize: 209_715_201 })).toMatchObject({ ok: false });
    expect(await attempt({ fileSize: 0 })).toMatchObject({ ok: false });
    expect(find('lesson_materials', 'insert')).toBeUndefined();
  });

  it('aula inexistente vira erro amigável', async () => {
    results['lessons.select'] = { data: null, error: null };
    expect(await createMaterial({ type: 'text', lessonId: LESSON, body: 'x' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Aula não encontrada'),
    });
    expect(find('lesson_materials', 'insert')).toBeUndefined();
  });

  it('conflito de posição (23505) vira erro amigável; outros erros propagam', async () => {
    results['lesson_materials.insert'] = { data: null, error: { code: '23505' } };
    expect(await createMaterial({ type: 'text', lessonId: LESSON, body: 'x' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('mudaram'),
    });
    results['lesson_materials.insert'] = { data: null, error: { code: '42501' } };
    await expect(createMaterial({ type: 'text', lessonId: LESSON, body: 'x' })).rejects.toThrow();
  });
});

describe('updateMaterial', () => {
  const current = (patch: object = {}) => ({
    data: {
      id: MATERIAL,
      lesson_id: LESSON,
      course_id: COURSE,
      type: 'text',
      storage_path: null,
      ...patch,
    },
    error: null,
  });

  it('não troca o tipo do material', async () => {
    results['lesson_materials.select'] = current({ type: 'link' });
    expect(await updateMaterial({ type: 'text', id: MATERIAL, body: 'x' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('tipo'),
    });
    expect(find('lesson_materials', 'update')).toBeUndefined();
  });

  it('texto: atualiza só título e corpo', async () => {
    results['lesson_materials.select'] = current();
    const result = await updateMaterial({ type: 'text', id: MATERIAL, title: 'T', body: 'novo' });
    expect(result).toMatchObject({ ok: true });
    expect(find('lesson_materials', 'update')?.arg).toEqual({ title: 'T', body: 'novo' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('show_in_all_lessons: grava quando enviado e não mexe quando ausente', async () => {
    results['lesson_materials.select'] = current();
    await updateMaterial({ type: 'text', id: MATERIAL, body: 'novo', showInAllLessons: true });
    expect(find('lesson_materials', 'update')?.arg).toEqual({
      title: null,
      body: 'novo',
      show_in_all_lessons: true,
    });
    calls.length = 0;
    await updateMaterial({ type: 'text', id: MATERIAL, body: 'novo' });
    expect(find('lesson_materials', 'update')?.arg).not.toHaveProperty('show_in_all_lessons');
  });

  it('vídeo: reparseia a URL no servidor', async () => {
    results['lesson_materials.select'] = current({ type: 'video' });
    expect(
      await updateMaterial({ type: 'video', id: MATERIAL, url: 'https://evil.com/x' }),
    ).toMatchObject({ ok: false });
    expect(find('lesson_materials', 'update')).toBeUndefined();
    await updateMaterial({
      type: 'video',
      id: MATERIAL,
      url: 'https://vimeo.com/76979871?h=abc123',
    });
    expect(find('lesson_materials', 'update')?.arg).toMatchObject({
      video_provider: 'vimeo',
      video_id: '76979871/abc123',
    });
  });

  it('arquivo: trocar o arquivo remove o objeto antigo depois de gravar', async () => {
    results['lesson_materials.select'] = current({ type: 'file', storage_path: PATH });
    const result = await updateMaterial({ type: 'file', id: MATERIAL, file: file(NEW_PATH) });
    expect(result).toMatchObject({ ok: true });
    expect(find('lesson_materials', 'update')?.arg).toMatchObject({ storage_path: NEW_PATH });
    expect(remove).toHaveBeenCalledWith('course-content', [PATH]);
  });

  it('arquivo: caminho de outra aula é rejeitado e nada é gravado ou removido', async () => {
    results['lesson_materials.select'] = current({ type: 'file', storage_path: PATH });
    const result = await updateMaterial({
      type: 'file',
      id: MATERIAL,
      file: file(`${COURSE}/${OTHER}/${UUID2}-x.zip`),
    });
    expect(result).toMatchObject({ ok: false, fieldErrors: { file: expect.any(Array) } });
    expect(find('lesson_materials', 'update')).toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it('arquivo: só título não mexe no storage', async () => {
    results['lesson_materials.select'] = current({ type: 'file', storage_path: PATH });
    await updateMaterial({ type: 'file', id: MATERIAL, title: 'Novo nome' });
    expect(find('lesson_materials', 'update')?.arg).toEqual({ title: 'Novo nome' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('material inexistente', async () => {
    results['lesson_materials.select'] = { data: null, error: null };
    expect(await updateMaterial({ type: 'text', id: MATERIAL, body: 'x' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Material não encontrado'),
    });
  });

  it('falha ao gravar não remove o arquivo antigo', async () => {
    results['lesson_materials.select'] = current({ type: 'file', storage_path: PATH });
    results['lesson_materials.update'] = { data: null, error: { code: '23514' } };
    await expect(
      updateMaterial({ type: 'file', id: MATERIAL, file: file(NEW_PATH) }),
    ).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('deleteMaterial', () => {
  it('exclusão de arquivo remove o objeto do storage', async () => {
    results['lesson_materials.select'] = {
      data: { id: MATERIAL, storage_path: PATH },
      error: null,
    };
    const result = await deleteMaterial({ id: MATERIAL });
    expect(result).toEqual({ ok: true, data: { id: MATERIAL } });
    expect(find('lesson_materials', 'delete')).toBeDefined();
    expect(remove).toHaveBeenCalledWith('course-content', [PATH]);
  });

  it('material sem arquivo não toca no storage', async () => {
    results['lesson_materials.select'] = {
      data: { id: MATERIAL, storage_path: null },
      error: null,
    };
    await deleteMaterial({ id: MATERIAL });
    expect(remove).not.toHaveBeenCalled();
  });

  it('falha no banco não remove o objeto', async () => {
    results['lesson_materials.select'] = {
      data: { id: MATERIAL, storage_path: PATH },
      error: null,
    };
    results['lesson_materials.delete'] = { data: null, error: { code: '42501' } };
    await expect(deleteMaterial({ id: MATERIAL })).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('falha ao remover do storage não invalida a exclusão', async () => {
    results['lesson_materials.select'] = {
      data: { id: MATERIAL, storage_path: PATH },
      error: null,
    };
    remove.mockRejectedValueOnce(new Error('storage fora do ar'));
    expect(await deleteMaterial({ id: MATERIAL })).toMatchObject({ ok: true });
  });

  it('material inexistente', async () => {
    results['lesson_materials.select'] = { data: null, error: null };
    expect(await deleteMaterial({ id: MATERIAL })).toMatchObject({ ok: false });
    expect(find('lesson_materials', 'delete')).toBeUndefined();
  });
});

describe('reorderMaterials', () => {
  it('chama a RPC reorder_materials com a lista completa', async () => {
    const result = await reorderMaterials({ lessonId: LESSON, ids: [B, A] });
    expect(result).toEqual({ ok: true, data: { ids: [B, A] } });
    expect(rpc).toHaveBeenCalledWith('reorder_materials', {
      p_lesson_id: LESSON,
      p_material_ids: [B, A],
    });
  });

  it('lista desatualizada (22023) vira erro amigável; outros erros propagam', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } });
    expect(await reorderMaterials({ lessonId: LESSON, ids: [A] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('mudaram'),
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(reorderMaterials({ lessonId: LESSON, ids: [A] })).rejects.toThrow();
  });
});

describe('discardUpload', () => {
  it('remove objeto órfão desta aula', async () => {
    results['lesson_materials.select'] = { data: [], error: null };
    expect(await discardUpload({ lessonId: LESSON, storagePath: PATH })).toMatchObject({
      ok: true,
    });
    expect(remove).toHaveBeenCalledWith('course-content', [PATH]);
  });

  it('não remove caminho de outra aula nem arquivo em uso', async () => {
    results['lesson_materials.select'] = { data: [], error: null };
    expect(
      await discardUpload({ lessonId: LESSON, storagePath: `${OTHER}/${LESSON}/${UUID}-a.zip` }),
    ).toMatchObject({ ok: false });
    expect(
      await discardUpload({ lessonId: LESSON, storagePath: '../../etc/passwd' }),
    ).toMatchObject({ ok: false });

    results['lesson_materials.select'] = { data: [{ id: MATERIAL }], error: null };
    expect(await discardUpload({ lessonId: LESSON, storagePath: PATH })).toMatchObject({
      ok: false,
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
