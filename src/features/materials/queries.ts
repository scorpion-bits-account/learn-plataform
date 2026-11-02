import 'server-only';

import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

import {
  groupMaterialsByLesson,
  MATERIAL_COLUMNS,
  toEditorMaterial,
  type EditorMaterial,
} from './model';

export type { EditorMaterial } from './model';

/** Leituras do editor de materiais: client do usuário; a RLS (`is_admin`) decide. */

export type LessonEditorData = {
  lesson: { id: string; title: string; moduleTitle: string };
  materials: EditorMaterial[];
};

/**
 * Aula + materiais em ordem. `null` quando o id é malformado, a aula não existe
 * ou NÃO pertence ao curso da URL (a página responde `notFound()`).
 */
export async function getLessonEditorData(
  courseId: string,
  lessonId: string,
): Promise<LessonEditorData | null> {
  if (!z.uuid().safeParse(courseId).success || !z.uuid().safeParse(lessonId).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lessons')
    .select(`id, title, course_modules(title), lesson_materials(${MATERIAL_COLUMNS})`)
    .eq('id', lessonId)
    .eq('course_id', courseId)
    .order('position', { ascending: true, referencedTable: 'lesson_materials' })
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar a aula.');
  if (!data) return null;

  const moduleRow = Array.isArray(data.course_modules)
    ? data.course_modules[0]
    : data.course_modules;

  return {
    lesson: { id: data.id, title: data.title, moduleTitle: moduleRow?.title ?? '' },
    materials: (data.lesson_materials ?? []).map(toEditorMaterial),
  };
}

/**
 * Materiais de TODAS as aulas do curso numa consulta só (sem N+1), agrupados por `lesson_id`
 * e em ordem. Id malformado => vazio. A RLS (`is_admin`) decide o acesso.
 */
export async function getCourseMaterials(
  courseId: string,
): Promise<Record<string, EditorMaterial[]>> {
  if (!z.uuid().safeParse(courseId).success) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lesson_materials')
    .select(`lesson_id, ${MATERIAL_COLUMNS}`)
    .eq('course_id', courseId)
    .order('position', { ascending: true });
  if (error) throw new Error('Não foi possível carregar os materiais.');
  return groupMaterialsByLesson(data ?? []);
}
