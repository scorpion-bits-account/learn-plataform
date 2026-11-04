import 'server-only';

import { cache } from 'react';

import { createPublicClient } from '@/lib/supabase/public';
import { createClient } from '@/lib/supabase/server';

import { deriveCategories, groupOutline, mapCatalogRow } from './model';
import type { CatalogCourse, CategoryOption, OutlineModule } from './model';
import { courseSlugSchema } from './schemas';

/**
 * Leituras do catálogo. Só views com `security_invoker`: a RLS decide o que volta.
 * Páginas públicas (landing, /cursos, /cursos/[slug]) usam o client SEM cookies
 * (`createPublicClient`, sempre visitante) para poderem ficar em cache; o que depende
 * do usuário (biblioteca) é resolvido no navegador (`ViewerProvider`). Nada de service role.
 */

export type CatalogData = {
  courses: CatalogCourse[];
  categories: CategoryOption[];
};

/** Cursos publicados (todos; os filtros são aplicados em memória, o catálogo é pequeno). */
export async function getCatalog(): Promise<CatalogData> {
  const supabase = createPublicClient();
  if (!supabase) return { courses: [], categories: [] };
  const { data, error } = await supabase
    .from('course_catalog')
    .select('*')
    .order('published_at', { ascending: false });
  if (error) throw new Error('Não foi possível carregar o catálogo.');

  const rows = data ?? [];
  const courses = rows.map(mapCatalogRow).filter((c): c is CatalogCourse => c !== null);
  return { courses, categories: deriveCategories(rows) };
}

/** Slugs publicados (pré-gera /cursos/[slug] no build). Falha ou sem env = nenhum (gera sob demanda). */
export async function getPublishedSlugs(): Promise<string[]> {
  try {
    const { courses } = await getCatalog();
    return courses.map((c) => c.slug);
  } catch {
    return [];
  }
}

export type CoursePageData = {
  course: CatalogCourse;
  outline: OutlineModule[];
};

/** Curso publicado por slug (memoizado por request: metadata + página). `null` se não existir. */
export const getPublishedCourse = cache(async (slug: string): Promise<CatalogCourse | null> => {
  const parsed = courseSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('course_catalog')
    .select('*')
    .eq('slug', parsed.data)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o curso.');
  return data ? mapCatalogRow(data) : null;
});

/** Versão pública (sem cookies) de `getPublishedCourse`, para a página do curso em cache. */
export const getPublicCourse = cache(async (slug: string): Promise<CatalogCourse | null> => {
  const parsed = courseSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  const supabase = createPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('course_catalog')
    .select('*')
    .eq('slug', parsed.data)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o curso.');
  return data ? mapCatalogRow(data) : null;
});

/** Curso + ementa, iguais para todos. "Já comprei?" é resolvido no navegador. */
export async function getCoursePage(slug: string): Promise<CoursePageData | null> {
  const course = await getPublicCourse(slug);
  if (!course) return null;

  const supabase = createPublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('course_outline')
    .select('*')
    .eq('course_id', course.id);
  if (error) throw new Error('Não foi possível carregar a ementa.');

  return { course, outline: groupOutline(data ?? []) };
}
