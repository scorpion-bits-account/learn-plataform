import 'server-only';

import { cache } from 'react';

import { groupOutline } from '@/features/catalog/model';
import type { OutlineModule } from '@/features/catalog/model';
import { getPublishedCourse } from '@/features/catalog/queries';
import { createClient } from '@/lib/supabase/server';

import {
  buildCourseMaterials,
  canOpenLesson,
  flattenOutline,
  lockForPreview,
  mapMaterialRow,
  resolveResumeLessonId,
} from './model';
import type { FlatLesson, LessonProgressRow, PlayerMaterial } from './model';
import { courseSlugSchema, lessonIdSchema } from './schemas';

/**
 * Leituras do player. Só o client do usuário: a RLS decide o que volta
 * (curso arquivado só para quem tem acesso, materiais só com acesso ou prévia).
 * Nada de service role aqui; o download assinado vive em `features/materials/storage.ts`.
 */

export type PlayerCourse = {
  id: string;
  slug: string;
  title: string;
  /** Prévia só vale em curso publicado. */
  published: boolean;
};

type CourseContext = {
  course: PlayerCourse;
  modules: OutlineModule[];
  lessons: FlatLesson[];
  hasAccess: boolean;
  progress: LessonProgressRow[];
};

/**
 * Curso do player por slug. Publicado -> reaproveita o catálogo (memoizado);
 * arquivado/rascunho -> lê `courses` (a RLS só devolve para quem tem acesso/admin).
 */
async function getPlayerCourse(slug: string): Promise<PlayerCourse | null> {
  const parsed = courseSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  const published = await getPublishedCourse(parsed.data);
  if (published) {
    return { id: published.id, slug: published.slug, title: published.title, published: true };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select('id, slug, title, status')
    .eq('slug', parsed.data)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o curso.');
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    published: data.status === 'published',
  };
}

/** `userId` nulo = visitante na prévia: sem acesso nem progresso (nem consulta). */
async function loadCourseContext(
  slug: string,
  userId: string | null,
): Promise<CourseContext | null> {
  const course = await getPlayerCourse(slug);
  if (!course) return null;

  const supabase = await createClient();
  const [outlineRes, accessRes, progressRes] = await Promise.all([
    supabase.from('course_outline').select('*').eq('course_id', course.id),
    userId
      ? supabase.rpc('has_course_access', { p_course_id: course.id })
      : Promise.resolve({ data: false, error: null }),
    // `user_id` explícito: a RLS deixa o admin ler o progresso de todos.
    userId
      ? supabase
          .from('lesson_progress')
          .select('lesson_id, completed_at, updated_at')
          .eq('course_id', course.id)
          .eq('user_id', userId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (outlineRes.error) throw new Error('Não foi possível carregar a ementa.');
  if (accessRes.error) throw new Error('Não foi possível verificar o acesso ao curso.');
  if (progressRes.error) throw new Error('Não foi possível carregar o progresso.');

  const modules = groupOutline(outlineRes.data ?? []);
  return {
    course,
    modules,
    lessons: flattenOutline(modules),
    hasAccess: accessRes.data === true,
    progress: (progressRes.data ?? []).map((row) => ({
      lessonId: row.lesson_id,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    })),
  };
}

/* --------------------------------------------------------------- retomada */

export type ResumeTarget =
  | { kind: 'lesson'; courseSlug: string; lessonId: string }
  /** Nenhuma aula abre (sem acesso e sem prévias): mandar para a página do curso. */
  | { kind: 'course'; courseSlug: string };

/** Aula de retomada do curso, ou `null` se o curso não existe/não é visível. */
export async function getResumeTarget(slug: string, userId: string): Promise<ResumeTarget | null> {
  const ctx = await loadCourseContext(slug, userId);
  if (!ctx) return null;

  const lessonId = resolveResumeLessonId(ctx.lessons, ctx.progress, {
    hasAccess: ctx.hasAccess,
    coursePublished: ctx.course.published,
  });
  return lessonId
    ? { kind: 'lesson', courseSlug: ctx.course.slug, lessonId }
    : { kind: 'course', courseSlug: ctx.course.slug };
}

/* ------------------------------------------------------------------- aula */

export type PlayerPageData = {
  course: PlayerCourse;
  modules: OutlineModule[];
  lessons: FlatLesson[];
  lesson: FlatLesson;
  hasAccess: boolean;
  /** Aula acessível (acesso ao curso ou prévia de curso publicado). */
  canOpen: boolean;
  completedIds: string[];
  materials: PlayerMaterial[];
  /** Materiais "em todas as aulas" de OUTRAS aulas do curso (ADMIN-010), em ordem da ementa. */
  courseMaterials: PlayerMaterial[];
};

/**
 * Tudo que a página da aula precisa. `null` (-> 404) se o curso não existe/não é visível
 * ou a aula não pertence a ele. Memoizado por request (metadata + página).
 * `userId` nulo = visitante (prévia sem login). Sem acesso, arquivos e links vêm bloqueados.
 */
export const getPlayerPage = cache(
  async (slug: string, lessonId: string, userId: string | null): Promise<PlayerPageData | null> => {
    if (!lessonIdSchema.safeParse(lessonId).success) return null;

    const ctx = await loadCourseContext(slug, userId);
    if (!ctx) return null;
    const lesson = ctx.lessons.find((l) => l.id === lessonId);
    if (!lesson) return null;

    const canOpen = canOpenLesson({
      hasAccess: ctx.hasAccess,
      isPreview: lesson.isPreview,
      coursePublished: ctx.course.published,
    });

    return {
      course: ctx.course,
      modules: ctx.modules,
      lessons: ctx.lessons,
      lesson,
      hasAccess: ctx.hasAccess,
      canOpen,
      completedIds: ctx.progress.filter((p) => p.completedAt).map((p) => p.lessonId),
      ...(canOpen
        ? await getMaterialsFor(ctx.course.id, lesson.id, ctx.lessons, ctx.hasAccess)
        : { materials: [], courseMaterials: [] }),
    };
  },
);

const MATERIAL_COLUMNS =
  'id, type, title, body, external_url, video_provider, video_id, file_name, file_size, mime_type, storage_path';

/**
 * Materiais da aula + materiais "em todas as aulas" do curso numa consulta só (sem N+1):
 * traz as linhas da aula OU com a flag e separa em memória. A RLS decide o que volta.
 * Sem `storage_path` no retorno (o cliente baixa por action).
 */
async function getMaterialsFor(
  courseId: string,
  lessonId: string,
  lessons: FlatLesson[],
  hasAccess: boolean,
): Promise<{ materials: PlayerMaterial[]; courseMaterials: PlayerMaterial[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lesson_materials')
    .select(`lesson_id, position, show_in_all_lessons, ${MATERIAL_COLUMNS}`)
    .eq('course_id', courseId)
    .or(`lesson_id.eq.${lessonId},show_in_all_lessons.eq.true`);
  if (error) throw new Error('Não foi possível carregar os materiais da aula.');

  const rows = data ?? [];
  const own = rows
    .filter((row) => row.lesson_id === lessonId)
    .sort((a, b) => a.position - b.position);
  return {
    materials: lockForPreview(
      own.map(mapMaterialRow).filter((m): m is PlayerMaterial => m !== null),
      hasAccess,
    ),
    courseMaterials: lockForPreview(
      buildCourseMaterials(
        rows.filter((row) => row.show_in_all_lessons),
        lessons,
        lessonId,
      ),
      hasAccess,
    ),
  };
}
