import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui';
import { formatBRL } from '@/features/students/format';

import {
  SOURCE_LABELS,
  paymentMethodLabel,
  STATUS_LABELS,
  STATUS_TONES,
  canRecheck,
  canRefund,
  eventResult,
  eventTypeLabel,
} from '../model';
import type { AdminOrderDetail } from '../model';
import { RecheckButton, RefundButton } from './OrderActions';
import styles from './Orders.module.css';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const fmtTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

/** Detalhe do pedido. `demo` liga as ações em modo simulado (vitrine). */
export function OrderDetailView({
  order,
  listPath,
  studentPath = '/admin/alunos',
  demo,
}: {
  order: AdminOrderDetail;
  listPath: string;
  studentPath?: string;
  demo?: boolean;
}) {
  const recheck = canRecheck(order);
  const refund = canRefund(order);
  const facts: [string, React.ReactNode][] = [
    ['Curso', order.courseTitle],
    ['Valor', formatBRL(order.amountCents)],
    ['Origem', SOURCE_LABELS[order.source]],
    ['Forma de pagamento', paymentMethodLabel(order.source, order.paymentMethod)],
    ['Criado em', fmtTime(order.createdAt)],
    ['Pago em', fmtTime(order.paidAt)],
    ['Expira em', fmtTime(order.expiresAt)],
    [
      order.paymentMethod === 'card' ? 'Checkout AbacatePay' : 'Cobrança AbacatePay',
      <span key="b" className={styles.mono}>
        {order.providerBillingId ?? '—'}
      </span>,
    ],
    ['Reembolso pedido em', fmtTime(order.refundRequestedAt)],
    ['Reembolsado em', fmtTime(order.refundedAt)],
  ];

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={listPath}>
        ← Pedidos
      </Link>
      <header className={styles.head}>
        <h1 className={styles.title}>Pedido de {order.courseTitle}</h1>
        <Badge tone={STATUS_TONES[order.status]}>{STATUS_LABELS[order.status]}</Badge>
      </header>

      <section className={styles.section} aria-labelledby="o-student">
        <h2 id="o-student" className={styles.sectionTitle}>
          Aluno
        </h2>
        <p>
          <Link className={styles.link} href={`${studentPath}/${order.userId}`}>
            {order.studentName || 'Sem nome'}
          </Link>
          <br />
          <span className={styles.dim}>{order.studentEmail ?? 'Email indisponível'}</span>
        </p>
      </section>

      <section className={styles.section} aria-labelledby="o-data">
        <h2 id="o-data" className={styles.sectionTitle}>
          Dados do pedido
        </h2>
        <dl className={styles.facts}>
          {facts.map(([label, value]) => (
            <div key={label} className={styles.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {recheck || refund ? (
        <section className={styles.section} aria-labelledby="o-actions">
          <h2 id="o-actions" className={styles.sectionTitle}>
            Ações
          </h2>
          {recheck ? (
            <>
              <p className={styles.muted}>
                Consulta a AbacatePay. Se a cobrança estiver paga, o acesso é liberado.
              </p>
              <RecheckButton orderId={order.id} demo={demo} />
            </>
          ) : null}
          {refund ? (
            <>
              {order.refundRequestedAt ? (
                <p className={styles.muted}>
                  O aluno pediu reembolso em {fmtTime(order.refundRequestedAt)} com{' '}
                  {order.refundRequestedProgress ?? order.progressPercent}% do curso consumido.
                </p>
              ) : (
                <p className={styles.muted}>
                  O aluno não pediu reembolso. Você ainda pode reembolsar por liberalidade.
                </p>
              )}
              <RefundButton
                orderId={order.id}
                courseTitle={order.courseTitle}
                amountCents={order.amountCents}
                progressPercent={order.progressPercent}
                requested={!!order.refundRequestedAt}
                demo={demo}
              />
            </>
          ) : null}
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="o-events">
        <h2 id="o-events" className={styles.sectionTitle}>
          Eventos do provedor
        </h2>
        {order.events.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Nenhum evento"
            description="A AbacatePay ainda não enviou eventos para este pedido."
          />
        ) : (
          <ol className={styles.timeline}>
            {order.events.map((e) => {
              const r = eventResult(e);
              return (
                <li
                  key={e.id}
                  className={`${styles.event} ${r.tone === 'ok' ? styles.eventOk : ''} ${
                    r.tone === 'error' ? styles.eventError : ''
                  }`}
                >
                  <strong>{eventTypeLabel(e.eventType)}</strong>
                  <span className={styles.dim}>
                    {fmtTime(e.receivedAt)} · {r.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
