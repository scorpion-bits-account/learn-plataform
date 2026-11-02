import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getPublishedCourse = vi.fn();
vi.mock('@/features/catalog/queries', () => ({
  getPublishedCourse: (slug: string) => getPublishedCourse(slug),
}));

type Result = { data: unknown; error: unknown };
const results: Record<string, Result> = {};
let rpcResult: Result = { data: true, error: null };
const calls: { table: string; eq: [string, unknown][]; or: string[] }[] = [];

function chain(table: string) {
  const call = { table, eq: [] as [string, unknown][], or: [] as string[] };
  calls.push(call);
  const api = {
    select: () => api,
    order: () => api,
    or: (filter: string) => {
      call.or.push(filter);
      return api;
    },
    eq: (column: string, value: unknown) => {
      call.eq.push([column, value]);
      return api;
    },
    maybeSingle: () => Promise.resolve(results[table] ?? { data: null, error: null }),
    then: (resolve: (r: Result) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve),
  };
  return api;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => chain(table),
    rpc: () => Promise.resolve(rpcResult),
  })),
}));

const { getResumeTarget, getPlayerPage } = await import('./queries');

const COURSE_ID = '10000000-0000-4000-8000-000000000001';
const L1 = '40000000-0000-4000-8000-000000000001';
const L2 = '40000000-0000-4000-8000-000000000002';
const L3 = '40000000-0000-4000-8000-000000000003';

const outlineRow = (lesson: string, position: number, preview = false) => ({
  course_id: COURSE_ID,
  module_id: 'm1',
  module_position: 0,
  module_title: 'Módulo',
  lesson_id: lesson,
  lesson_position: position,
  lesson_title: `Aula ${position}`,
  lesson_summary: null,
  duration_seconds: 60,
  is_preview: preview,
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const key of Object.keys(results)) delete results[key];
  rpcResult = { data: true, error: null };
  getPublishedCourse.mockResolvedValue({ id: COURSE_ID, slug: 'godot', title: 'Godot' });
  results.course_outline = {
    data: [outlineRow(L2, 1), outlineRow(L1, 0, true), outlineRow(L3, 2)],
    error: null,
  };
  results.lesson_progress = { data: [], error: null };
});

describe('getResumeTarget', () => {
  it('curso inexistente: null', async () => {
    getPublishedCourse.mockResolvedValue(null);
    results.courses = { data: null, error: null };
    await expect(getResumeTarget('nada', 'u1')).resolves.toBeNull();
  });

  it('sem progresso: primeira aula', async () => {
    await expect(getResumeTarget('godot', 'u1')).resolves.toEqual({
      kind: 'lesson',
      courseSlug: 'godot',
      lessonId: L1,
    });
  });

  it('retoma a aula com updated_at mais recente e filtra o progresso pelo próprio usuário', async () => {
    results.lesson_progress = {
      data: [
        { lesson_id: L1, completed_at: '2026-10-01T10:30:00Z', updated_at: '2026-10-01T10:00:00Z' },
        { lesson_id: L3, completed_at: null, updated_at: '2026-10-05T10:00:00Z' },
      ],
      error: null,
    };
    await expect(getResumeTarget('godot', 'u1')).resolves.toMatchObject({ lessonId: L3 });
    const progressCall = calls.find((c) => c.table === 'lesson_progress');
    expect(progressCall?.eq).toContainEqual(['user_id', 'u1']);
    expect(progressCall?.eq).toContainEqual(['course_id', COURSE_ID]);
  });

  it('sem acesso e sem prévia aberta: manda para a página do curso', async () => {
    rpcResult = { data: false, error: null };
    results.course_outline = { data: [outlineRow(L2, 1)], error: null };
    await expect(getResumeTarget('godot', 'u1')).resolves.toEqual({
      kind: 'course',
      courseSlug: 'godot',
    });
  });

  it('sem acesso, abre a primeira prévia', async () => {
    rpcResult = { data: false, error: null };
    await expect(getResumeTarget('godot', 'u1')).resolves.toMatchObject({
      kind: 'lesson',
      lessonId: L1,
    });
  });

  it('cai no courses (RLS) para curso arquivado a que o aluno ainda tem acesso', async () => {
    getPublishedCourse.mockResolvedValue(null);
    results.courses = {
      data: { id: COURSE_ID, slug: 'godot', title: 'Godot', status: 'archived' },
      error: null,
    };
    await expect(getResumeTarget('godot', 'u1')).resolves.toMatchObject({ kind: 'lesson' });
  });

  it('erro do banco propaga (error.tsx), sem virar "sem acesso"', async () => {
    results.course_outline = { data: null, error: { message: 'boom' } };
    await expect(getResumeTarget('godot', 'u1')).rejects.toThrow();
    results.course_outline = { data: [], error: null };
    rpcResult = { data: null, error: { message: 'boom' } };
    await expect(getResumeTarget('godot', 'u1')).rejects.toThrow();
  });
});

describe('getPlayerPage', () => {
  it('uuid malformado ou aula de outro curso: null', async () => {
    await expect(getPlayerPage('godot', 'nao-uuid', 'u1')).resolves.toBeNull();
    await expect(
      getPlayerPage('godot', '40000000-0000-4000-8000-0000000000ff', 'u1'),
    ).resolves.toBeNull();
  });

  it('com acesso carrega materiais sem storage_path', async () => {
    results.lesson_materials = {
      data: [
        {
          id: 'mat-1',
          lesson_id: L2,
          position: 0,
          show_in_all_lessons: false,
          type: 'file',
          title: 'Guia',
          body: null,
          external_url: null,
          video_provider: null,
          video_id: null,
          file_name: 'guia.zip',
          file_size: 10,
          mime_type: 'application/zip',
          storage_path: 'c/l/secret-path.zip',
        },
      ],
      error: null,
    };
    const data = await getPlayerPage('godot', L2, 'u1');
    expect(data?.canOpen).toBe(true);
    expect(data?.materials).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('secret-path');
  });

  it('separa os materiais "do curso" (outras aulas) numa única consulta, em ordem da ementa', async () => {
    const row = (id: string, lesson: string, position: number, all: boolean) => ({
      id,
      lesson_id: lesson,
      position,
      show_in_all_lessons: all,
      type: 'link',
      title: id,
      body: null,
      external_url: 'https://exemplo.com',
      video_provider: null,
      video_id: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      storage_path: null,
    });
    results.lesson_materials = {
      data: [
        row('own', L2, 0, false),
        row('own-all', L2, 1, true),
        row('from-l3', L3, 0, true),
        row('from-l1-b', L1, 1, true),
        row('from-l1-a', L1, 0, true),
      ],
      error: null,
    };
    const data = await getPlayerPage('godot', L2, 'u1');
    expect(data?.materials.map((m) => m.id)).toEqual(['own', 'own-all']);
    // A aula de origem não duplica; ordem: aula (ementa) e depois posição do material.
    expect(data?.courseMaterials.map((m) => m.id)).toEqual(['from-l1-a', 'from-l1-b', 'from-l3']);
    const materialCalls = calls.filter((c) => c.table === 'lesson_materials');
    expect(materialCalls).toHaveLength(1);
    expect(materialCalls[0]!.or[0]).toContain(`lesson_id.eq.${L2}`);
    expect(materialCalls[0]!.or[0]).toContain('show_in_all_lessons.eq.true');
  });

  it('aula bloqueada: nem consulta os materiais', async () => {
    rpcResult = { data: false, error: null };
    const data = await getPlayerPage('godot', L2, 'u2');
    expect(data).toMatchObject({
      canOpen: false,
      hasAccess: false,
      materials: [],
      courseMaterials: [],
    });
    expect(calls.some((c) => c.table === 'lesson_materials')).toBe(false);
  });

  it('prévia sem compra abre', async () => {
    rpcResult = { data: false, error: null };
    results.lesson_materials = { data: [], error: null };
    const data = await getPlayerPage('godot', L1, 'u3');
    expect(data).toMatchObject({ canOpen: true, hasAccess: false });
  });
});
