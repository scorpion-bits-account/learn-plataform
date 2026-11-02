import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ErrorState, Skeleton } from '@/components/ui';
import { ManualSaleForm } from '@/features/orders/components/OrderActions';
import { MyOrdersView } from '@/features/orders/components/MyOrdersView';
import { OrderDetailView } from '@/features/orders/components/OrderDetailView';
import { OrdersFilters, OrdersList, OrdersSearch } from '@/features/orders/components/OrdersList';
import type { AdminOrderDetail, AdminOrderListItem, MyOrder } from '@/features/orders/model';
import { PAGE_SIZE, parseOrderListParams } from '@/features/orders/schemas';

export const metadata: Metadata = {
  title: 'Vitrine · pedidos admin',
  robots: { index: false, follow: false },
};

const NOW = Date.parse('2026-10-09T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const NAMES = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Rocha', 'Elisa Prado', 'Fábio Reis'];
const COURSES = ['Godot do zero', 'Pixel art para jogos', 'Shaders 2D na prática'];
const STATUSES = ['paid', 'paid', 'pending', 'expired', 'failed', 'refunded', 'canceled'] as const;

const ALL: AdminOrderListItem[] = Array.from({ length: 47 }, (_, i) => {
  const status = STATUSES[i % STATUSES.length]!;
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    status,
    source: i % 9 === 8 ? 'manual' : 'checkout',
    paymentMethod: i % 9 === 8 ? null : i % 3 === 1 ? 'card' : 'pix',
    amountCents: [19_700, 14_700, 9_900][i % 3]!,
    createdAt: day(i % 20),
    paidAt: status === 'paid' || status === 'refunded' ? day(i % 20) : null,
    refundRequestedAt: status === 'paid' && i % 4 === 0 ? day(1) : null,
    courseTitle: COURSES[i % 3]!,
    userId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    studentName: `${NAMES[i % 6]} ${i + 1}`,
    studentEmail: `${NAMES[i % 6]!.split(' ')[0]!.toLowerCase()}${i}@exemplo.com`,
  };
});

const DETAIL: AdminOrderDetail = {
  id: ALL[0]!.id,
  status: 'paid',
  source: 'checkout',
  paymentMethod: 'pix',
  amountCents: 19_700,
  createdAt: day(3),
  paidAt: day(3),
  expiresAt: day(3),
  refundRequestedAt: day(1),
  refundedAt: null,
  providerBillingId: 'pix_char_demo123',
  courseId: 'c1',
  courseTitle: 'Godot do zero',
  userId: ALL[0]!.userId,
  studentName: 'Ana Souza',
  studentEmail: 'ana0@exemplo.com',
  progressPercent: 35,
  refundRequestedProgress: 30,
  events: [
    {
      id: 'e1',
      eventType: 'transparent.completed',
      receivedAt: day(3),
      processedAt: day(3),
      processingError: null,
    },
    {
      id: 'e2',
      eventType: 'transparent.completed',
      receivedAt: day(3),
      processedAt: null,
      processingError: 'fulfill_order: amount_mismatch',
    },
    {
      id: 'e3',
      eventType: 'transparent.refunded',
      receivedAt: day(0),
      processedAt: null,
      processingError: null,
    },
  ],
};

const MINE: MyOrder[] = [
  {
    id: 'm1',
    courseTitle: 'Godot do zero',
    status: 'paid',
    source: 'checkout',
    amountCents: 19_700,
    createdAt: day(2),
    paidAt: day(2),
    refundRequestedAt: null,
    refundedAt: null,
  },
  {
    id: 'm2',
    courseTitle: 'Pixel art para jogos',
    status: 'paid',
    source: 'checkout',
    amountCents: 14_700,
    createdAt: day(10),
    paidAt: day(10),
    refundRequestedAt: null,
    refundedAt: null,
  },
  {
    id: 'm3',
    courseTitle: 'Shaders 2D na prática',
    status: 'paid',
    source: 'checkout',
    amountCents: 9_900,
    createdAt: day(4),
    paidAt: day(4),
    refundRequestedAt: day(3),
    refundedAt: null,
  },
  {
    id: 'm4',
    courseTitle: 'Áudio para jogos indie',
    status: 'refunded',
    source: 'checkout',
    amountCents: 14_700,
    createdAt: day(30),
    paidAt: day(30),
    refundRequestedAt: day(29),
    refundedAt: day(27),
  },
];

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Vitrine com dados fictícios. `?view=detalhe|aluno|venda`, `?state=loading|empty|error`, `?filtro=reembolso`, `?status=`, `?q=`. */
export default async function AdminOrdersShowcase({ searchParams }: { searchParams: SP }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const raw = await searchParams;
  const params = parseOrderListParams(raw);
  const base = '/dev/admin-orders';
  const state = raw.state;

  let body;
  if (state === 'loading') {
    body = (
      <div role="status" aria-label="Carregando pedidos" style={{ display: 'grid', gap: '1rem' }}>
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </div>
    );
  } else if (state === 'error') {
    body = <ErrorState message="Não foi possível carregar os pedidos. Tente novamente." />;
  } else if (raw.view === 'detalhe') {
    body = (
      <OrderDetailView order={DETAIL} listPath={base} studentPath="/dev/admin-students" demo />
    );
  } else if (raw.view === 'aluno') {
    body = <MyOrdersView orders={state === 'empty' ? [] : MINE} now={NOW} demo />;
  } else {
    const q = params.q.toLowerCase();
    const filtered =
      state === 'empty'
        ? []
        : ALL.filter((o) => {
            if (params.refundQueue) return o.status === 'paid' && o.refundRequestedAt;
            if (params.status && o.status !== params.status) return false;
            return (
              !q || `${o.studentName} ${o.studentEmail} ${o.courseTitle}`.toLowerCase().includes(q)
            );
          });
    body = (
      <>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <h1 style={{ fontSize: 'var(--s-2)' }}>Pedidos</h1>
          <ManualSaleForm
            demo
            courses={COURSES.map((title, i) => ({ id: `c${i}`, title, priceCents: 19_700 }))}
          />
        </div>
        <OrdersSearch basePath={base} params={params} />
        <OrdersFilters basePath={base} params={params} />
        <OrdersList
          rows={filtered.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE)}
          total={filtered.length}
          params={params}
          basePath={base}
        />
      </>
    );
  }

  return (
    <main
      style={{
        maxWidth: '72rem',
        margin: '0 auto',
        padding: 'var(--space-5) var(--space-4)',
        display: 'grid',
        gap: 'var(--space-4)',
      }}
    >
      {body}
    </main>
  );
}
