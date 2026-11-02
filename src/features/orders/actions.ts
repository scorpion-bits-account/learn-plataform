'use server';

import { revalidatePath } from 'next/cache';

import { ActionError, adminAction, userAction } from '@/lib/auth/actions';
import {
  PaymentProviderError,
  getCardCheckoutStatus,
  getPixStatus,
  refundCardCheckout,
  refundPixCharge,
} from '@/lib/payments/abacatepay';
import { providerVerdict } from '@/lib/payments/verdict';
import { createClient } from '@/lib/supabase/server';

import {
  FULFILL_MESSAGES,
  FULFILL_OK,
  REQUEST_REFUND_MESSAGES,
  canRecheck,
  canRefund,
} from './model';
import { manualSaleSchema, orderActionSchema } from './schemas';
import { fulfillOrderAsService } from './service';

const REFUND_SENT_MESSAGE =
  'Reembolso enviado — o acesso será removido quando a AbacatePay confirmar.';

function revalidateOrders(orderId?: string) {
  revalidatePath('/admin/pedidos');
  if (orderId) revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath('/admin');
}

/** Mensagem em pt-BR para a falha do provedor (nunca inclui texto do provedor). */
function providerMessage(error: unknown): string {
  if (!(error instanceof PaymentProviderError))
    return 'Falha inesperada ao falar com a AbacatePay.';
  switch (error.code) {
    case 'insufficient_funds':
      return 'Saldo insuficiente na conta da AbacatePay para este reembolso. Adicione saldo (ou aguarde novas vendas) e tente de novo.';
    case 'under_dispute':
      return 'A transação está em disputa e não pode ser reembolsada agora.';
    case 'not_refundable':
      return 'A AbacatePay informa que esta transação não pode ser reembolsada.';
    case 'unauthorized':
      return `A AbacatePay recusou a chave de API: verifique na Vercel a ABACATEPAY_API_KEY e as permissões (TRANSPARENT:READ, CHECKOUT:READ, REFUND:CREATE). Detalhe: ${error.message}`;
    case 'invalid_request':
      return `A AbacatePay recusou a requisição. Detalhe: ${error.message}`;
    case 'provider_unavailable':
    default:
      // Mensagens de `PaymentProviderError` são nossas (sem texto do provedor): ok para o admin.
      return `Não foi possível consultar a AbacatePay. Detalhe: ${error.message}`;
  }
}

async function readOrder(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, source, provider_billing_id, amount_cents, payment_method')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error('Falha ao ler o pedido.');
  if (!data) throw new ActionError('Pedido não encontrado.');
  return data;
}

/**
 * PAY-005 — "Reconsultar pagamento". Só concede acesso se o PROVEDOR disser
 * `PAID` (PIX: `transparents/check`; cartão: `checkouts/get`, PAY-007) com os
 * valores do pedido; a concessão é `fulfill_order` (service role, módulo `service.ts`).
 */
export const recheckPayment = adminAction(orderActionSchema, async ({ orderId }) => {
  const order = await readOrder(orderId);
  const billingId = order.provider_billing_id;
  if (!billingId || !canRecheck({ status: order.status, providerBillingId: billingId })) {
    throw new ActionError(
      'Só é possível reconsultar pedidos pendentes, expirados ou com falha que tenham cobrança na AbacatePay.',
    );
  }

  let remote;
  try {
    remote =
      order.payment_method === 'card'
        ? await getCardCheckoutStatus(billingId)
        : await getPixStatus(billingId);
  } catch (error) {
    throw new ActionError(providerMessage(error));
  }

  const verdict = providerVerdict(remote, { id: order.id, amountCents: order.amount_cents });
  if (verdict === 'amount_mismatch' || verdict === 'billing_mismatch') {
    throw new ActionError(
      'A AbacatePay informa um valor ou pedido diferente deste. Nenhum acesso foi liberado: confira a cobrança no painel da AbacatePay.',
    );
  }
  if (verdict !== 'paid') {
    return {
      granted: false as const,
      message: `A AbacatePay informa que a cobrança está “${remote.status}”. Nenhum acesso foi liberado.`,
    };
  }

  let result: string;
  try {
    // A reconsulta nem sempre traz valor; sem ele, usa o do pedido (a cobrança foi criada com ele).
    result = await fulfillOrderAsService({
      orderId: order.id,
      billingId,
      amountCents: remote.amountCents ?? order.amount_cents,
    });
  } catch {
    throw new ActionError('Não foi possível registrar o pagamento. Tente novamente.');
  }

  revalidateOrders(order.id);
  const message = FULFILL_MESSAGES[result] ?? 'Resultado inesperado ao liberar o pedido.';
  if (!FULFILL_OK.has(result)) throw new ActionError(message);
  return { granted: true as const, message };
});

/**
 * PAY-006 — executa o reembolso na AbacatePay. NÃO revoga o acesso nem muda o
 * pedido: isso é do webhook `refunded` (`refund_order`).
 */
export const executeRefund = adminAction(orderActionSchema, async ({ orderId }) => {
  const order = await readOrder(orderId);
  const billingId = order.provider_billing_id;
  if (
    !billingId ||
    !canRefund({ status: order.status, source: order.source, providerBillingId: billingId })
  ) {
    throw new ActionError('Só é possível reembolsar pedidos pagos pelo checkout (PIX ou cartão).');
  }

  let alreadyRefunded: boolean;
  try {
    ({ alreadyRefunded } =
      order.payment_method === 'card'
        ? await refundCardCheckout(billingId)
        : await refundPixCharge(billingId));
  } catch (error) {
    throw new ActionError(providerMessage(error));
  }

  revalidateOrders(order.id);
  return {
    alreadyRefunded,
    message: alreadyRefunded
      ? 'A AbacatePay já havia reembolsado esta cobrança. O acesso será removido quando a confirmação chegar.'
      : REFUND_SENT_MESSAGE,
  };
});

const MANUAL_SALE_ERRORS: Record<string, string> = {
  P0002: 'Curso não encontrado.',
  '22023': 'O curso não está publicado ou o valor é inválido.',
  '23505': 'Este aluno já tem uma compra ativa deste curso.',
};

/** Venda manual: cria pedido `manual` pago + matrícula numa transação (RPC com `is_admin()`). */
export const recordManualSale = adminAction(manualSaleSchema, async (input) => {
  const supabase = await createClient();

  const { data: found, error: findError } = await supabase.rpc('admin_students', {
    p_search: input.email,
    p_limit: 5,
    p_offset: 0,
  });
  if (findError) throw new Error('Falha ao buscar o aluno.');
  const student = (found ?? []).find((s) => s.email.toLowerCase() === input.email);
  if (!student) {
    const msg = 'Nenhum aluno cadastrado com este email.';
    throw new ActionError(msg, { email: [msg] });
  }

  const { data, error } = await supabase.rpc('admin_record_manual_sale', {
    p_user_id: student.user_id,
    p_course_id: input.courseId,
    p_amount_cents: input.amount,
  });
  if (error) {
    const msg = MANUAL_SALE_ERRORS[error.code];
    if (!msg) throw new Error('Falha ao registrar a venda.');
    throw new ActionError(msg, error.code === '23505' ? { email: [msg] } : { courseId: [msg] });
  }

  revalidateOrders();
  revalidatePath(`/admin/alunos/${student.user_id}`);
  return { orderId: typeof data === 'string' ? data : null };
});

/** Aluno pede reembolso do PRÓPRIO pedido; prazo e dono são verificados pela RPC (`auth.uid()`). */
export const requestRefund = userAction(orderActionSchema, async ({ orderId }) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_refund', { p_order_id: orderId });
  if (error || typeof data !== 'string') throw new Error('Falha ao solicitar o reembolso.');
  if (data !== 'requested') {
    throw new ActionError(
      REQUEST_REFUND_MESSAGES[data] ?? 'Não foi possível solicitar o reembolso deste pedido.',
    );
  }
  revalidatePath('/conta/pedidos');
  revalidatePath('/admin/pedidos');
  return { message: 'Pedido de reembolso enviado. A equipe vai analisar e te avisar.' };
});
