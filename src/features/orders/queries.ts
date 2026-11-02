import 'server-only';

import { createClient } from '@/lib/supabase/server';

import type { AdminOrderDetail, AdminOrderListItem, MyOrder } from './model';
import { PAGE_SIZE, orderIdSchema } from './schemas';
import type { OrderListParams } from './schemas';

/** Leituras com o client do usuário: a RLS (`orders_select_own_or_admin`, `is_admin()`) decide. */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_LIMIT = 50;

const one = <T>(rel: T | T[] | null): T | null => (Array.isArray(rel) ? (rel[0] ?? null) : rel);

/** Nome e email (só admin lê o email, via RPC) de um conjunto de alunos. */
async function loadStudents(
  supabase: Supabase,
  userIds: string[],
): Promise<Map<string, { name: string; email: string | null }>> {
  const map = new Map<string, { name: string; email: string | null }>();
  if (userIds.length === 0) return map;
  const [profiles, emails] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('id', userIds),
    Promise.all(userIds.map((id) => supabase.rpc('admin_student_by_id', { p_user_id: id }))),
  ]);
  if (profiles.error) throw new Error('Não foi possível carregar os alunos dos pedidos.');
  for (const p of profiles.data ?? []) map.set(p.id, { name: p.full_name, email: null });
  userIds.forEach((id, i) => {
    const email = emails[i]?.data?.[0]?.email ?? null;
    const current = map.get(id);
    map.set(id, { name: current?.name ?? '', email });
  });
  return map;
}

export async function listOrders(
  params: OrderListParams,
): Promise<{ rows: AdminOrderListItem[]; total: number }> {
  const supabase = await createClient();

  // Busca: email/nome do aluno (RPC admin), título do curso ou id do pedido.
  let searchFilter: string | null = null;
  if (params.q) {
    const term = params.q.replace(/[,()*%_\\"]/g, ' ').trim();
    const conds: string[] = [];
    if (UUID_RE.test(params.q)) conds.push(`id.eq.${params.q}`);
    if (term) {
      const [students, courses] = await Promise.all([
        supabase.rpc('admin_students', { p_search: term, p_limit: SEARCH_LIMIT, p_offset: 0 }),
        supabase.from('courses').select('id').ilike('title', `%${term}%`).limit(SEARCH_LIMIT),
      ]);
      if (students.error || courses.error) throw new Error('Não foi possível buscar os pedidos.');
      const userIds = (students.data ?? []).map((s) => s.user_id);
      const courseIds = (courses.data ?? []).map((c) => c.id);
      if (userIds.length) conds.push(`user_id.in.(${userIds.join(',')})`);
      if (courseIds.length) conds.push(`course_id.in.(${courseIds.join(',')})`);
    }
    if (conds.length === 0) return { rows: [], total: 0 };
    searchFilter = conds.join(',');
  }

  let query = supabase
    .from('orders')
    .select(
      'id, user_id, status, source, payment_method, amount_cents, created_at, paid_at, refund_requested_at, courses(title)',
      { count: 'exact' },
    );
  if (params.refundQueue) {
    query = query.eq('status', 'paid').not('refund_requested_at', 'is', null);
  } else if (params.status) {
    query = query.eq('status', params.status);
  }
  if (searchFilter) query = query.or(searchFilter);
  query = params.refundQueue
    ? query.order('refund_requested_at', { ascending: true })
    : query.order('created_at', { ascending: false });

  const from = (params.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error('Não foi possível carregar os pedidos.');

  const students = await loadStudents(supabase, [...new Set((data ?? []).map((o) => o.user_id))]);
  const rows = (data ?? []).map((o) => ({
    id: o.id,
    status: o.status,
    source: o.source,
    paymentMethod: o.payment_method,
    amountCents: o.amount_cents,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    refundRequestedAt: o.refund_requested_at,
    courseTitle: one(o.courses)?.title ?? 'Curso removido',
    userId: o.user_id,
    studentName: students.get(o.user_id)?.name ?? '',
    studentEmail: students.get(o.user_id)?.email ?? null,
  }));
  return { rows, total: count ?? 0 };
}

/** Detalhe do pedido + linha do tempo de eventos (sem `payload`). `null` se não existe. */
export async function getOrderDetail(id: string): Promise<AdminOrderDetail | null> {
  if (!orderIdSchema.safeParse(id).success) return null;
  const supabase = await createClient();

  const { data: o, error } = await supabase
    .from('orders')
    .select(
      'id, user_id, course_id, status, source, amount_cents, created_at, paid_at, expires_at, refund_requested_at, refund_requested_progress, refunded_at, provider_billing_id, payment_method, courses(title)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o pedido.');
  if (!o) return null;

  const [events, lessons, done, students] = await Promise.all([
    supabase
      .from('payment_events')
      .select('id, event_type, received_at, processed_at, processing_error')
      .eq('order_id', id)
      .order('received_at', { ascending: true }),
    supabase
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', o.course_id),
    supabase
      .from('lesson_progress')
      .select('lesson_id', { count: 'exact', head: true })
      .eq('user_id', o.user_id)
      .eq('course_id', o.course_id)
      .not('completed_at', 'is', null),
    loadStudents(supabase, [o.user_id]),
  ]);
  if (events.error || lessons.error || done.error) {
    throw new Error('Não foi possível carregar o pedido.');
  }

  const total = lessons.count ?? 0;
  const completed = Math.min(done.count ?? 0, total);
  const student = students.get(o.user_id);
  return {
    id: o.id,
    status: o.status,
    source: o.source,
    paymentMethod: o.payment_method,
    amountCents: o.amount_cents,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    expiresAt: o.expires_at,
    refundRequestedAt: o.refund_requested_at,
    refundedAt: o.refunded_at,
    providerBillingId: o.provider_billing_id,
    courseId: o.course_id,
    courseTitle: one(o.courses)?.title ?? 'Curso removido',
    userId: o.user_id,
    studentName: student?.name ?? '',
    studentEmail: student?.email ?? null,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    refundRequestedProgress: o.refund_requested_progress,
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      eventType: e.event_type,
      receivedAt: e.received_at,
      processedAt: e.processed_at,
      processingError: e.processing_error,
    })),
  };
}

/** Cursos para a venda manual (a RPC valida de novo: só publicados). */
export async function listSellableCourses(): Promise<
  { id: string; title: string; priceCents: number }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('courses')
    .select('id, title, price_cents')
    .eq('status', 'published')
    .order('title', { ascending: true });
  if (error) throw new Error('Não foi possível carregar os cursos.');
  return (data ?? []).map((c) => ({ id: c.id, title: c.title, priceCents: c.price_cents }));
}

/** Pedidos pagos/reembolsados do próprio aluno (a RLS limita a `user_id = auth.uid()`). */
export async function listMyOrders(userId: string): Promise<MyOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, source, amount_cents, created_at, paid_at, refund_requested_at, refunded_at, courses(title)',
    )
    .eq('user_id', userId)
    .in('status', ['paid', 'refunded'])
    .order('paid_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error('Não foi possível carregar seus pedidos.');
  return (data ?? []).map((o) => ({
    id: o.id,
    courseTitle: one(o.courses)?.title ?? 'Curso removido',
    status: o.status,
    source: o.source,
    amountCents: o.amount_cents,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    refundRequestedAt: o.refund_requested_at,
    refundedAt: o.refunded_at,
  }));
}
