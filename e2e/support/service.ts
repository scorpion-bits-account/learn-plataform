import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadE2eEnv } from './env';

/**
 * Setup/verificação dos testes com o service role do Supabase LOCAL (nunca é usado pelo
 * app testado). Cada teste cria os próprios dados com sufixo único: não depende de ordem
 * nem de limpeza (o banco local é descartável).
 */

export const PASSWORD = 'E2e-senha-123';

let cached: SupabaseClient | undefined;
export function service(): SupabaseClient {
  if (!cached) {
    const env = loadE2eEnv();
    cached = createClient(env.supabaseUrl, env.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function must<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`E2E setup: ${what}: ${result.error?.message ?? 'sem dados'}`);
  }
  return result.data as NonNullable<T>;
}

/** Sufixo curto e único (a mesma execução pode rodar 3 projects em paralelo). */
export function uid(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${uid()}@e2e.test`;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
}

/** Usuário já confirmado (o trigger cria profile e papel `student`). */
export async function createUser(options: {
  prefix: string;
  fullName?: string;
  admin?: boolean;
}): Promise<TestUser> {
  const email = uniqueEmail(options.prefix);
  const fullName = options.fullName ?? `E2E ${options.prefix} ${uid()}`;
  const { data, error } = await service().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`E2E setup: createUser: ${error?.message}`);
  if (options.admin) {
    // Papel admin só por service role/SQL (ADR-005).
    const { error: roleError } = await service()
      .from('user_roles')
      .insert({ user_id: data.user.id, role: 'admin' });
    if (roleError) throw new Error(`E2E setup: admin role: ${roleError.message}`);
  }
  return { id: data.user.id, email, password: PASSWORD, fullName };
}

export interface TestCourse {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  lessons: { id: string; title: string; body: string }[];
}

/** Curso publicado com 1 módulo e `lessonCount` aulas, cada uma com um material de texto. */
export async function createPublishedCourse(
  options: { priceCents?: number; lessonCount?: number; isPreview?: boolean } = {},
): Promise<TestCourse> {
  const suffix = uid();
  const priceCents = options.priceCents ?? 4990;
  const lessonCount = options.lessonCount ?? 2;
  const title = `Curso E2E ${suffix}`;
  const slug = `curso-e2e-${suffix}`;

  const course = must(
    await service()
      .from('courses')
      .insert({
        slug,
        title,
        subtitle: 'Curso criado pelo robô E2E',
        description: 'Descrição do curso de teste.',
        price_cents: priceCents,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
    'course',
  );
  const module_ = must(
    await service()
      .from('course_modules')
      .insert({ course_id: course.id, title: `Módulo ${suffix}`, position: 0 })
      .select('id')
      .single(),
    'module',
  );

  const lessons: TestCourse['lessons'] = [];
  for (let i = 0; i < lessonCount; i++) {
    const lessonTitle = `Aula ${i + 1} ${suffix}`;
    const lesson = must(
      await service()
        .from('lessons')
        .insert({
          module_id: module_.id,
          course_id: course.id,
          title: lessonTitle,
          position: i,
          is_preview: options.isPreview === true && i === 0,
        })
        .select('id')
        .single(),
      'lesson',
    );
    const body = `Conteúdo secreto da aula ${i + 1} ${suffix}`;
    must(
      await service()
        .from('lesson_materials')
        .insert({
          lesson_id: lesson.id,
          course_id: course.id,
          type: 'text',
          title: 'Leitura',
          position: 0,
          body,
        })
        .select('id')
        .single(),
      'material',
    );
    lessons.push({ id: lesson.id, title: lessonTitle, body });
  }
  return { id: course.id, slug, title, priceCents, lessons };
}

/** Pedido pago + matrícula de compra pelo mesmo caminho do app (`fulfill_order`). */
export async function createPaidOrder(user: TestUser, course: TestCourse): Promise<string> {
  const order = must(
    await service()
      .from('orders')
      .insert({
        user_id: user.id,
        course_id: course.id,
        amount_cents: course.priceCents,
        status: 'pending',
        source: 'checkout',
        provider: 'abacatepay',
        provider_billing_id: `pix_char_seed_${uid()}`,
      })
      .select('id, provider_billing_id')
      .single(),
    'order',
  );
  const { data, error } = await service().rpc('fulfill_order', {
    p_order_id: order.id,
    p_provider_billing_id: order.provider_billing_id,
    p_amount_cents: course.priceCents,
  });
  if (error || data !== 'fulfilled') {
    throw new Error(`E2E setup: fulfill_order: ${error?.message ?? String(data)}`);
  }
  return order.id;
}

export async function grantCourse(user: TestUser, course: TestCourse, admin: TestUser) {
  must(
    await service()
      .from('enrollments')
      .insert({
        user_id: user.id,
        course_id: course.id,
        source: 'admin_grant',
        granted_by: admin.id,
      })
      .select('id')
      .single(),
    'enrollment',
  );
}

export async function getOrder(orderId: string) {
  return must(
    await service()
      .from('orders')
      .select('id, status, amount_cents, provider_billing_id, payment_method, user_id, course_id')
      .eq('id', orderId)
      .single(),
    'getOrder',
  );
}

/** Id do pedido que gravou esta cobrança/checkout (`null` se nenhum). */
export async function findOrderIdByBilling(billingId: string): Promise<string | null> {
  const { data, error } = await service()
    .from('orders')
    .select('id')
    .eq('provider_billing_id', billingId)
    .maybeSingle();
  if (error) throw new Error(`findOrderIdByBilling: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

export async function getCourseByTitle(title: string) {
  return (
    await service()
      .from('courses')
      .select('id, slug, status, cover_path, price_cents')
      .eq('title', title)
      .maybeSingle()
  ).data;
}

export async function activeEnrollmentCount(userId: string, courseId: string): Promise<number> {
  const { count } = await service()
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .is('revoked_at', null);
  return count ?? 0;
}

export async function completedLessonCount(userId: string, courseId: string): Promise<number> {
  const { count } = await service()
    .from('lesson_progress')
    .select('lesson_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .not('completed_at', 'is', null);
  return count ?? 0;
}

export async function getFullName(userId: string): Promise<string | null> {
  const { data } = await service().from('profiles').select('full_name').eq('id', userId).single();
  return (data?.full_name as string | null | undefined) ?? null;
}
