'use server';

import { revalidatePath } from 'next/cache';

import { ActionError, adminAction } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

import { nextPosition } from '@/features/curriculum/order';

import {
  CONTENT_BUCKET_NAME,
  createMaterialSchema,
  deleteMaterialSchema,
  discardUploadSchema,
  isPathInLesson,
  parseVideoUrl,
  reorderMaterialsSchema,
  updateMaterialSchema,
} from './schemas';
import type { UploadedFile } from './schemas';

const STALE = 'Os materiais mudaram em outra aba ou sessão. Recarregamos a lista; tente de novo.';
const LESSON_NOT_FOUND = 'Aula não encontrada. Ela pode ter sido excluída.';
const MATERIAL_NOT_FOUND = 'Material não encontrado. Ele pode ter sido excluído.';
const BAD_PATH = 'O arquivo enviado não pertence a esta aula. Envie o arquivo de novo.';
const BAD_VIDEO = 'Use uma URL de vídeo do YouTube ou do Vimeo.';

type DbError = { code?: string; message?: string } | null;
type Client = Awaited<ReturnType<typeof createClient>>;
type Insert = Database['public']['Tables']['lesson_materials']['Insert'];
type Patch = Database['public']['Tables']['lesson_materials']['Update'];

/**
 * Conflito de posição (23505), lista desatualizada (22023, das funções reorder_*) e pai
 * inexistente (23503) viram erro amigável; o resto propaga como erro inesperado.
 */
function throwFriendly(error: NonNullable<DbError>, fallback: string): never {
  if (error.code === '23505' || error.code === '22023' || error.code === '23503') {
    throw new ActionError(STALE);
  }
  throw new Error(fallback);
}

function refresh() {
  revalidatePath('/admin/cursos/[id]/aulas/[lessonId]', 'page');
  revalidatePath('/admin/cursos/[id]', 'page');
}

/** Remoção de objetos é best-effort: falhar não desfaz a mudança já gravada no banco. */
async function removeFiles(supabase: Client, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(CONTENT_BUCKET_NAME).remove(paths);
  } catch {
    // objeto órfão é preferível a uma exclusão que parece ter falhado
  }
}

async function readLesson(supabase: Client, lessonId: string) {
  const { data, error } = await supabase
    .from('lessons')
    .select('id, course_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw new Error('Falha ao ler a aula.');
  if (!data) throw new ActionError(LESSON_NOT_FOUND);
  return data;
}

/** O servidor não confia no cliente: o caminho precisa estar sob `<curso>/<aula>/`. */
function assertOwnPath(file: UploadedFile, courseId: string, lessonId: string) {
  if (!isPathInLesson(file.storagePath, courseId, lessonId)) {
    throw new ActionError(BAD_PATH, { file: [BAD_PATH] });
  }
}

function fileColumns(file: UploadedFile) {
  return {
    storage_path: file.storagePath,
    file_name: file.fileName,
    file_size: file.fileSize,
    mime_type: file.mimeType,
  };
}

/* ---------------------------------------------------------------- criar */

export const createMaterial = adminAction(createMaterialSchema, async (input) => {
  const supabase = await createClient();
  const lesson = await readLesson(supabase, input.lessonId);

  const base = {
    lesson_id: lesson.id,
    // O banco sobrescreve com o course_id da aula (trigger); enviamos o mesmo valor.
    course_id: lesson.course_id,
    title: input.title,
    show_in_all_lessons: input.showInAllLessons,
  };

  let row: Omit<Insert, 'position'>;
  switch (input.type) {
    case 'video': {
      const video = parseVideoUrl(input.url);
      if (!video) throw new ActionError(BAD_VIDEO, { url: [BAD_VIDEO] });
      row = { ...base, type: 'video', video_provider: video.provider, video_id: video.videoId };
      break;
    }
    case 'text':
      row = { ...base, type: 'text', body: input.body };
      break;
    case 'link':
      row = { ...base, type: 'link', external_url: input.url };
      break;
    case 'file':
      assertOwnPath(input.file, lesson.course_id, lesson.id);
      row = { ...base, type: 'file', ...fileColumns(input.file) };
      break;
  }

  const { data: last, error: readError } = await supabase
    .from('lesson_materials')
    .select('position')
    .eq('lesson_id', lesson.id)
    .order('position', { ascending: false })
    .limit(1);
  if (readError) throw new Error('Falha ao ler os materiais.');

  const { data, error } = await supabase
    .from('lesson_materials')
    .insert({ ...row, position: nextPosition((last ?? []).map((m) => m.position)) })
    .select('id')
    .single();
  if (error) throwFriendly(error, 'Falha ao criar o material.');

  refresh();
  return { id: data.id };
});

/* --------------------------------------------------------------- editar */

export const updateMaterial = adminAction(updateMaterialSchema, async (input) => {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from('lesson_materials')
    .select('id, lesson_id, course_id, type, storage_path')
    .eq('id', input.id)
    .maybeSingle();
  if (readError) throw new Error('Falha ao ler o material.');
  if (!current) throw new ActionError(MATERIAL_NOT_FOUND);
  // Trocar o tipo = excluir e criar outro (os checks do banco proíbem campos de outros tipos).
  if (current.type !== input.type) {
    throw new ActionError('Não é possível trocar o tipo do material. Exclua e crie outro.');
  }

  const patch: Patch = { title: input.title };
  if (input.showInAllLessons !== undefined) patch.show_in_all_lessons = input.showInAllLessons;
  let oldPath: string | null = null;

  switch (input.type) {
    case 'video':
      if (input.url !== undefined) {
        const video = parseVideoUrl(input.url);
        if (!video) throw new ActionError(BAD_VIDEO, { url: [BAD_VIDEO] });
        patch.video_provider = video.provider;
        patch.video_id = video.videoId;
      }
      break;
    case 'text':
      patch.body = input.body;
      break;
    case 'link':
      patch.external_url = input.url;
      break;
    case 'file':
      if (input.file) {
        assertOwnPath(input.file, current.course_id, current.lesson_id);
        Object.assign(patch, fileColumns(input.file));
        if (current.storage_path !== input.file.storagePath) oldPath = current.storage_path;
      }
      break;
  }

  const { data, error } = await supabase
    .from('lesson_materials')
    .update(patch)
    .eq('id', input.id)
    .select('id')
    .maybeSingle();
  if (error) throwFriendly(error, 'Falha ao salvar o material.');
  if (!data) throw new ActionError(MATERIAL_NOT_FOUND);

  // Só depois do banco gravado: o arquivo trocado deixa de ser referenciado.
  if (oldPath) await removeFiles(supabase, [oldPath]);

  refresh();
  return { id: input.id };
});

/* -------------------------------------------------------------- excluir */

export const deleteMaterial = adminAction(deleteMaterialSchema, async ({ id }) => {
  const supabase = await createClient();

  const { data: material, error: readError } = await supabase
    .from('lesson_materials')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error('Falha ao ler o material.');
  if (!material) throw new ActionError(MATERIAL_NOT_FOUND);

  const { error } = await supabase.from('lesson_materials').delete().eq('id', id);
  if (error) throw new Error('Falha ao excluir o material.');

  await removeFiles(supabase, material.storage_path ? [material.storage_path] : []);

  refresh();
  return { id };
});

/* ------------------------------------------------------------ reordenar */

export const reorderMaterials = adminAction(reorderMaterialsSchema, async ({ lessonId, ids }) => {
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_materials', {
    p_lesson_id: lessonId,
    p_material_ids: ids,
  });
  if (error) throwFriendly(error, 'Falha ao reordenar os materiais.');

  refresh();
  return { ids };
});

/* ---------------------------------------------- upload abandonado/falho */

/**
 * Remove um objeto enviado pelo cliente que não chegou a virar material (falha ao salvar).
 * Só mexe em caminhos desta aula e nunca em um arquivo que algum material referencia.
 */
export const discardUpload = adminAction(discardUploadSchema, async ({ lessonId, storagePath }) => {
  const supabase = await createClient();
  const lesson = await readLesson(supabase, lessonId);
  if (!isPathInLesson(storagePath, lesson.course_id, lesson.id)) throw new ActionError(BAD_PATH);

  const { data: inUse, error } = await supabase
    .from('lesson_materials')
    .select('id')
    .eq('storage_path', storagePath)
    .limit(1);
  if (error) throw new Error('Falha ao verificar o arquivo.');
  if ((inUse ?? []).length > 0) throw new ActionError('Este arquivo está em uso por um material.');

  await removeFiles(supabase, [storagePath]);
  return { storagePath };
});
