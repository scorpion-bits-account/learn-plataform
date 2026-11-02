import 'server-only';

import { getPublishedCourse } from '@/features/catalog/queries';
import { withCover } from '@/features/catalog/presenters';
import type { CourseView } from '@/features/catalog/components/types';
import { requireUser } from '@/lib/auth/dal';
import { formatBrPhone, formatCpf } from '@/lib/payments/tax-id';
import { isAbacatePayCheckoutUrl, resolveAbacatePayBaseUrl } from '@/lib/payments/api-base-url';
import { createClient } from '@/lib/supabase/server';

import { toQrSrc } from './model';
import type { CheckoutPrefill, MyOrder, OrderPaymentMethod } from './model';
import { orderIdSchema, REUSE_MIN_REMAINING_MS } from './schemas';

/**
 * Leituras do checkout. Só o client do usuário (RLS) e sempre filtrando pelo
 * `user_id` da sessão (o admin enxerga todos os pedidos pela RLS).
 * Nada de service role aqui.
 */

export type CheckoutPageData = {
  course: CourseView;
  hasAccess: boolean;
  prefill: CheckoutPrefill;
  /** Pedido pendente com cobrança ainda válida (para "Ver PIX gerado"/"Ver pagamento"). */
  pendingOrderId: string | null;
  /** Método do pedido pendente acima. */
  pendingMethod: OrderPaymentMethod | null;
};

/** URL do checkout hospedado só se for da AbacatePay (ou do mock E2E); senão `null`. */
function safeCheckoutUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return isAbacatePayCheckoutUrl(
      url,
      resolveAbacatePayBaseUrl(process.env.ABACATEPAY_API_BASE_URL),
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

/** `null` se o curso não existir/não estiver publicado. Curso sem preço volta com `priceCents = 0`. */
export async function getCheckoutPage(slug: string): Promise<CheckoutPageData | null> {
  const user = await requireUser();
  const course = await getPublishedCourse(slug);
  if (!course) return null;

  const supabase = await createClient();
  const [accessRes, profileRes, pendingRes] = await Promise.all([
    supabase.rpc('has_course_access', { p_course_id: course.id }),
    supabase.from('profiles').select('tax_id, phone').eq('id', user.id).maybeSingle(),
    supabase
      .from('orders')
      .select('id, expires_at, pix_br_code, checkout_url, payment_method')
      .eq('user_id', user.id)
      .eq('course_id', course.id)
      .eq('status', 'pending')
      .maybeSingle(),
  ]);
  if (accessRes.error) throw new Error('Não foi possível verificar o acesso ao curso.');

  // Prefill e pedido pendente são conforto: se falharem, o formulário vem vazio.
  const profile = profileRes.error ? null : profileRes.data;
  const pending = pendingRes.error ? null : pendingRes.data;
  const pendingValid =
    (pending?.pix_br_code || pending?.checkout_url) &&
    pending.expires_at &&
    Date.parse(pending.expires_at) - Date.now() > REUSE_MIN_REMAINING_MS;

  return {
    course: withCover(course),
    hasAccess: accessRes.data === true,
    prefill: {
      taxId: profile?.tax_id ? formatCpf(profile.tax_id) : '',
      phone: profile?.phone ? formatBrPhone(profile.phone) : '',
    },
    pendingOrderId: pendingValid ? pending.id : null,
    pendingMethod: pendingValid ? (pending.payment_method ?? 'pix') : null,
  };
}

/** Pedido do próprio usuário (RLS + filtro por `user_id`). `null` se não existir ou for de outro. */
export async function getMyOrder(orderId: string): Promise<MyOrder | null> {
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return null;

  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, amount_cents, expires_at, created_at, course_id, pix_br_code, pix_br_code_base64, payment_method, checkout_url',
    )
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error('Não foi possível carregar o pedido.');
  if (!data) return null;

  // Título é só exibição: se o curso não for legível (ex.: arquivado sem acesso), usa genérico.
  const { data: course } = await supabase
    .from('courses')
    .select('slug, title')
    .eq('id', data.course_id)
    .maybeSingle();

  return {
    id: data.id,
    status: data.status,
    amountCents: data.amount_cents,
    expiresAt: data.expires_at,
    createdAt: data.created_at,
    hasPix: Boolean(data.pix_br_code),
    paymentMethod: data.payment_method ?? 'pix',
    checkoutUrl: data.status === 'pending' ? safeCheckoutUrl(data.checkout_url) : null,
    pixBrCode: data.status === 'pending' ? data.pix_br_code : null,
    pixQrSrc: data.status === 'pending' ? toQrSrc(data.pix_br_code_base64) : null,
    course: { slug: course?.slug ?? null, title: course?.title ?? 'Curso' },
  };
}
