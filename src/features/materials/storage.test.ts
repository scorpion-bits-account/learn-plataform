import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const rpc = vi.fn(async () => ({ data: true, error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from, rpc })),
}));

const createSignedUrl = vi.fn();
const storageFrom = vi.fn(() => ({ createSignedUrl }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ storage: { from: storageFrom } })),
}));

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co/',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  }),
}));

const { getMaterialDownloadUrl, getCoverPublicUrl, SIGNED_URL_TTL_SECONDS } =
  await import('./storage');

const MATERIAL_ID = '50000000-0000-4000-8000-000000000003';

describe('getMaterialDownloadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita id malformado sem tocar no banco', async () => {
    await expect(getMaterialDownloadUrl('../../etc')).resolves.toEqual({
      ok: false,
      error: 'invalid_id',
    });
    expect(from).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('não assina nada quando a RLS esconde o material (sem acesso)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(from).toHaveBeenCalledWith('lesson_materials');
    expect(eq).toHaveBeenCalledWith('id', MATERIAL_ID);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('recusa material que não é arquivo', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: MATERIAL_ID, type: 'video', storage_path: null, file_name: null },
      error: null,
    });
    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: false,
      error: 'not_a_file',
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('prévia sem compra: material visível pela RLS, mas o download é recusado', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: MATERIAL_ID,
        type: 'file',
        storage_path: 'c/l/uuid-a.zip',
        file_name: 'a.zip',
        course_id: 'c1',
      },
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(rpc).toHaveBeenCalledWith('has_course_access', { p_course_id: 'c1' });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('erro de leitura vira unavailable', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('assina URL curta no bucket privado com o nome do arquivo', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: MATERIAL_ID,
        type: 'file',
        storage_path: 'c/l/abc-projeto.zip',
        file_name: 'projeto.zip',
      },
      error: null,
    });
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://signed/url' },
      error: null,
    });

    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: true,
      data: { url: 'https://signed/url', fileName: 'projeto.zip', expiresInSeconds: 600 },
    });
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
    expect(storageFrom).toHaveBeenCalledWith('course-content');
    expect(createSignedUrl).toHaveBeenCalledWith('c/l/abc-projeto.zip', 600, {
      download: 'projeto.zip',
    });
  });

  it('usa o fim do caminho (sem prefixo uuid) quando file_name está vazio', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: MATERIAL_ID,
        type: 'file',
        storage_path: 'c/l/0b0e2d5a-1111-4222-8333-444455556666-assets.zip',
        file_name: null,
      },
      error: null,
    });
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u' }, error: null });

    const result = await getMaterialDownloadUrl(MATERIAL_ID);
    expect(result).toMatchObject({ ok: true, data: { fileName: 'assets.zip' } });
  });

  it('falha ao assinar vira unavailable', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: MATERIAL_ID, type: 'file', storage_path: 'c/l/x.zip', file_name: 'x.zip' },
      error: null,
    });
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    await expect(getMaterialDownloadUrl(MATERIAL_ID)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('getCoverPublicUrl', () => {
  it('monta a URL pública do bucket de capas, codificando cada segmento', () => {
    expect(getCoverPublicUrl('curso 1/capa #1.webp')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/course-covers/curso%201/capa%20%231.webp',
    );
  });

  it('retorna null sem capa', () => {
    expect(getCoverPublicUrl(null)).toBeNull();
    expect(getCoverPublicUrl('  ')).toBeNull();
  });
});
