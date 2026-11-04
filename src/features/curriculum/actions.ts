'use server';

import { revalidatePath } from 'next/cache';

import { ActionError, adminAction } from '@/lib/auth/actions';
import { revalidatePublicPages } from '@/lib/cache/public-pages';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

import { nextPosition } from './order';
import {
  createLessonSchema,
  createModuleSchema,
  deleteLessonSchema,
  deleteModuleSchema,
  minutesToSeconds,
  renameLessonSchema,
  renameModuleSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  setLessonDurationSchema,
  setLessonPreviewSchema,
} from './schemas';

const CONTENT_BUCKET_NAME = 'course-content';

const STALE = 'A ementa mudou em outra aba ou sessão. Recarregamos a lista; tente de novo.';
const MODULE_NOT_FOUND = 'Módulo não encontrado. Ele pode ter sido excluído.';
const LESSON_NOT_FOUND = 'Aula não encontrada. Ela pode ter sido excluída.';

type DbError = { code?: string; message?: string } | null;

/**
 * Conflitos de posição (23505 no commit deferido), listas desatualizadas (22023, vindas das
 * funções reorder_*) e pais inexistentes (23503) viram erro amigável; o resto propaga.
 */
function throwFriendly(error: NonNullable<DbError>, fallback: string): never {
  if (error.code === '23505' || error.code === '22023' || error.code === '23503') {
    throw new ActionError(STALE);
  }
  throw new Error(fallback);
}

function refresh() {
  revalidatePublicPages();
  revalidatePath('/admin/cursos/[id]', 'page');
}

type MaterialPaths = { storage_path: string | null }[] | null;

function storagePaths(...groups: (MaterialPaths | undefined)[]): string[] {
  return groups
    .flatMap((group) => group ?? [])
    .map((material) => material.storage_path)
    .filter((path): path is string => Boolean(path));
}

/** Arquivos de materiais apagados em cascata ficariam órfãos: remoção best-effort. */
async function removeFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(CONTENT_BUCKET_NAME).remove(paths);
  } catch {
    // falha não invalida a exclusão já feita
  }
}

/* ------------------------------------------------------------------ módulos */

export const createModule = adminAction(createModuleSchema, async ({ courseId, title }) => {
  const supabase = await createClient();

  const { data: last, error: readError } = await supabase
    .from('course_modules')
    .select('position')
    .eq('course_id', courseId)
    .order('position', { ascending: false })
    .limit(1);
  if (readError) throw new Error('Falha ao ler a ementa.');

  const { data, error } = await supabase
    .from('course_modules')
    .insert({
      course_id: courseId,
      title,
      position: nextPosition((last ?? []).map((row) => row.position)),
    })
    .select('id')
    .single();
  if (error) throwFriendly(error, 'Falha ao criar o módulo.');

  refresh();
  return { id: data.id };
});

export const renameModule = adminAction(renameModuleSchema, async ({ id, title }) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('course_modules')
    .update({ title })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('Falha ao renomear o módulo.');
  if (!data) throw new ActionError(MODULE_NOT_FOUND);

  refresh();
  return { id };
});

export const deleteModule = adminAction(deleteModuleSchema, async ({ id }) => {
  const supabase = await createClient();

  const { data: module, error: readError } = await supabase
    .from('course_modules')
    .select('id, lessons(lesson_materials(storage_path))')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error('Falha ao ler o módulo.');
  if (!module) throw new ActionError(MODULE_NOT_FOUND);

  const { error } = await supabase.from('course_modules').delete().eq('id', id);
  if (error) throw new Error('Falha ao excluir o módulo.');

  await removeFiles(
    supabase,
    storagePaths(...(module.lessons ?? []).map((lesson) => lesson.lesson_materials)),
  );

  refresh();
  return { id };
});

export const reorderModules = adminAction(reorderModulesSchema, async ({ courseId, ids }) => {
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_modules', {
    p_course_id: courseId,
    p_module_ids: ids,
  });
  if (error) throwFriendly(error, 'Falha ao reordenar os módulos.');

  refresh();
  return { ids };
});

/* -------------------------------------------------------------------- aulas */

export const createLesson = adminAction(createLessonSchema, async ({ moduleId, title }) => {
  const supabase = await createClient();

  const { data: module, error: moduleError } = await supabase
    .from('course_modules')
    .select('course_id')
    .eq('id', moduleId)
    .maybeSingle();
  if (moduleError) throw new Error('Falha ao ler o módulo.');
  if (!module) throw new ActionError(MODULE_NOT_FOUND);

  const { data: last, error: readError } = await supabase
    .from('lessons')
    .select('position')
    .eq('module_id', moduleId)
    .order('position', { ascending: false })
    .limit(1);
  if (readError) throw new Error('Falha ao ler o módulo.');

  const { data, error } = await supabase
    .from('lessons')
    .insert({
      module_id: moduleId,
      // O banco sobrescreve com o course_id do módulo (trigger); enviamos o mesmo valor.
      course_id: module.course_id,
      title,
      position: nextPosition((last ?? []).map((row) => row.position)),
    })
    .select('id')
    .single();
  if (error) throwFriendly(error, 'Falha ao criar a aula.');

  refresh();
  return { id: data.id };
});

async function updateLesson(
  id: string,
  patch: Database['public']['Tables']['lessons']['Update'],
  failure: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lessons')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(failure);
  if (!data) throw new ActionError(LESSON_NOT_FOUND);
  refresh();
  return { id };
}

export const renameLesson = adminAction(renameLessonSchema, ({ id, title }) =>
  updateLesson(id, { title }, 'Falha ao renomear a aula.'),
);

export const setLessonPreview = adminAction(setLessonPreviewSchema, ({ id, isPreview }) =>
  updateLesson(id, { is_preview: isPreview }, 'Falha ao alterar a prévia.'),
);

/** Recebe minutos e grava segundos (`null` limpa a duração). */
export const setLessonDuration = adminAction(setLessonDurationSchema, ({ id, minutes }) =>
  updateLesson(id, { duration_seconds: minutesToSeconds(minutes) }, 'Falha ao salvar a duração.'),
);

export const deleteLesson = adminAction(deleteLessonSchema, async ({ id }) => {
  const supabase = await createClient();

  const { data: lesson, error: readError } = await supabase
    .from('lessons')
    .select('id, lesson_materials(storage_path)')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error('Falha ao ler a aula.');
  if (!lesson) throw new ActionError(LESSON_NOT_FOUND);

  const { error } = await supabase.from('lessons').delete().eq('id', id);
  if (error) throw new Error('Falha ao excluir a aula.');

  await removeFiles(supabase, storagePaths(lesson.lesson_materials));

  refresh();
  return { id };
});

export const reorderLessons = adminAction(reorderLessonsSchema, async ({ moduleId, ids }) => {
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_lessons', {
    p_module_id: moduleId,
    p_lesson_ids: ids,
  });
  if (error) throwFriendly(error, 'Falha ao reordenar as aulas.');

  refresh();
  return { ids };
});
