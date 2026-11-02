import Link from 'next/link';

import { ChamferCard, IsoCover } from '@/components/brand';
import { Button, EmptyState } from '@/components/ui';
import type { CourseView } from '@/features/catalog/components/types';
import { formatPrice } from '@/features/catalog/model';

import type { CheckoutFormState, CheckoutPrefill, OrderPaymentMethod } from '../model';
import { cardMaxInstallments } from '../schemas';
import styles from './Checkout.module.css';
import { CheckoutForm } from './CheckoutForm';

export interface CheckoutViewProps {
  course: CourseView;
  hasAccess: boolean;
  prefill: CheckoutPrefill;
  pendingOrderId: string | null;
  /** Método do pedido pendente (padrão PIX). */
  pendingMethod?: OrderPaymentMethod | null;
  /** Só para a vitrine `/dev/checkout`. */
  initialState?: CheckoutFormState;
}

function Crumbs({ course }: { course: CourseView }) {
  return (
    <nav aria-label="Você está em" className={styles.crumbs}>
      <Link href="/cursos">Cursos</Link>
      <span aria-hidden="true"> / </span>
      <Link href={`/cursos/${course.slug}`}>{course.title}</Link>
      <span aria-hidden="true"> / </span>
      <span aria-current="page">Pagamento</span>
    </nav>
  );
}

/** `/checkout/[slug]`: resumo do curso + forma de pagamento (PIX ou cartão). */
export function CheckoutView({
  course,
  hasAccess,
  prefill,
  pendingOrderId,
  pendingMethod = 'pix',
  initialState,
}: CheckoutViewProps) {
  if (hasAccess || course.priceCents <= 0) {
    return (
      <div className={styles.page}>
        <Crumbs course={course} />
        <EmptyState
          title={hasAccess ? 'Você já possui este curso' : 'Este curso não está à venda'}
          description={
            hasAccess
              ? 'Ele já está na sua biblioteca. Bons estudos!'
              : 'No momento não é possível comprar este curso.'
          }
          action={
            hasAccess ? (
              <Button href={`/aprender/${course.slug}`}>Ir para o curso</Button>
            ) : (
              <Button href={`/cursos/${course.slug}`} variant="secondary">
                Voltar para o curso
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Crumbs course={course} />
      <h1 className={styles.heading}>Finalizar compra</h1>

      <div className={styles.layout}>
        <ChamferCard as="section" aria-labelledby="resumo-titulo">
          <div className={styles.summary}>
            <div className={styles.cover}>
              <IsoCover
                src={course.coverUrl}
                alt=""
                title={course.title}
                sizes="(max-width: 719px) 7rem, (max-width: 1023px) 40vw, 640px"
              />
            </div>
            <div className={styles.summaryText}>
              <p className={styles.eyebrow} id="resumo-titulo">
                Resumo do pedido
              </p>
              <h2 className={styles.courseTitle}>{course.title}</h2>
            </div>
            <p className={styles.total}>
              <span className={styles.totalLabel}>Total</span>
              <span className={styles.price}>{formatPrice(course.priceCents)}</span>
            </p>
            <p className={styles.method}>Pagamento único via PIX ou cartão de crédito.</p>
          </div>
        </ChamferCard>

        <ChamferCard as="section" aria-labelledby="dados-titulo">
          <h2 id="dados-titulo" className={styles.formTitle}>
            Pagamento
          </h2>
          {pendingOrderId ? (
            <div className={styles.notice} role="status">
              <p>
                {pendingMethod === 'card'
                  ? 'Você já iniciou um pagamento com cartão para este curso.'
                  : 'Você já gerou um PIX para este curso e ele ainda está válido.'}
              </p>
              <Button href={`/checkout/pedido/${pendingOrderId}`} variant="secondary" fullWidth>
                {pendingMethod === 'card' ? 'Ver pagamento iniciado' : 'Ver PIX gerado'}
              </Button>
            </div>
          ) : null}
          <CheckoutForm
            courseSlug={course.slug}
            cardInstallments={cardMaxInstallments(course.priceCents)}
            defaultTaxId={prefill.taxId}
            defaultPhone={prefill.phone}
            initialState={initialState}
          />
        </ChamferCard>
      </div>
    </div>
  );
}
