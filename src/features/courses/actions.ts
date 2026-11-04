'use server';

import { revalidatePath } from 'next/cache';

import { ActionError, adminAction } from '@/lib/auth/actions';
import { revalidatePublicPages } from '@/lib/cache/public-pages';
import { createClient } from '@/lib/supabase/server';

import { COVERS_BUCKET_NAME, publishBlockers } from './rules';
import {
  createCourseSchema,
  setCourseStatusSchema,
  updateCourseSchema,
  STATUS_LABELS,
} from './schemas';

const SLUG_TAKEN = 'Já existe um curso com este endereço. Escolha outro.';

type DbError = { code?: string; message?: string } | null;

/** Traduz violações de constraint em erros de campo. Outros erros propagam (error boundary). */
function throwFriendly(error: NonNullable<DbError>): never {
  if (error.code === '23505') throw new ActionError(SLUG_TAKEN, { slug: [SLUG_TAKEN] });
  if (error.code === '23514' && error.message?.includes('courses_published_requires_price')) {
    const msg = 'Curso publicado precisa de preço maior que zero. Despublique antes de zerar.';
    throw new ActionError(msg, { price: [msg] });
  }
  throw new Error('Falha ao salvar o curso.');
}

export const createCourse = adminAction(createCourseSchema, async (input, { user }) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .insert({
      slug: input.slug,
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      category_id: input.categoryId,
      level: input.level,
      price_cents: input.price,
      status: 'draft',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) throwFriendly(error);
  revalidatePath('/admin/cursos');
  revalidatePublicPages();
  return { id: data.id };
});

export const updateCourse = adminAction(updateCourseSchema, async (input) => {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from('courses')
    .select('cover_path')
    .eq('id', input.id)
    .maybeSingle();
  if (readError) throw new Error('Falha ao ler o curso.');
  if (!current) throw new ActionError('Curso não encontrado.');

  const { error } = await supabase
    .from('courses')
    .update({
      slug: input.slug,
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      category_id: input.categoryId,
      level: input.level,
      price_cents: input.price,
      cover_path: input.coverPath,
    })
    .eq('id', input.id);
  if (error) throwFriendly(error);

  // Capa antiga fica órfã: remoção best-effort (falha não invalida o salvamento).
  if (current.cover_path && current.cover_path !== input.coverPath) {
    await supabase.storage
      .from(COVERS_BUCKET_NAME)
      .remove([current.cover_path])
      .catch(() => undefined);
  }

  revalidatePath('/admin/cursos');
  revalidatePublicPages();
  revalidatePath(`/admin/cursos/${input.id}`);
  return { id: input.id };
});

/** Publicar / despublicar (volta a rascunho) / arquivar, com validação do que falta. */
export const setCourseStatus = adminAction(setCourseStatusSchema, async ({ id, status }) => {
  const supabase = await createClient();

  if (status === 'published') {
    const { data: course, error } = await supabase
      .from('courses')
      .select('title, price_cents, cover_path, lessons(count)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Falha ao ler o curso.');
    if (!course) throw new ActionError('Curso não encontrado.');

    const lessons = Array.isArray(course.lessons)
      ? ((course.lessons[0] as { count?: number } | undefined)?.count ?? 0)
      : 0;
    const missing = publishBlockers({
      title: course.title,
      priceCents: course.price_cents,
      coverPath: course.cover_path,
      lessonCount: lessons,
    });
    if (missing.length > 0) {
      throw new ActionError(`Para publicar, falta: ${missing.join('; ')}.`);
    }
  }

  const { data, error } = await supabase
    .from('courses')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throwFriendly(error);
  if (!data) throw new ActionError('Curso não encontrado.');

  revalidatePath('/admin/cursos');
  revalidatePublicPages();
  revalidatePath(`/admin/cursos/${id}`);
  return { id, status, label: STATUS_LABELS[status] };
});
