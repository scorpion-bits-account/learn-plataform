import Link from 'next/link';

import { Badge, Button, EmptyState, Input, Pagination, Table } from '@/components/ui';
import type { TableColumn } from '@/components/ui';
import { formatBRL, formatDate } from '@/features/students/format';

import { STATUS_LABELS, STATUS_TONES, paymentMethodLabel } from '../model';
import type { AdminOrderListItem } from '../model';
import { ORDER_STATUSES, PAGE_SIZE } from '../schemas';
import type { OrderListParams } from '../schemas';
import styles from './Orders.module.css';

export function ordersHref(basePath: string, p: Partial<OrderListParams>, page = 1): string {
  const params = new URLSearchParams();
  if (p.refundQueue) params.set('filtro', 'reembolso');
  else if (p.status) params.set('status', p.status);
  if (p.q) params.set('q', p.q);
  if (page > 1) params.set('pagina', String(page));
  const s = params.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/** Busca por GET (funciona sem JS) que preserva o filtro atual. */
export function OrdersSearch({ basePath, params }: { basePath: string; params: OrderListParams }) {
  return (
    <form action={basePath} method="get" role="search" className={styles.search}>
      {params.refundQueue ? <input type="hidden" name="filtro" value="reembolso" /> : null}
      {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
      <label className="visually-hidden" htmlFor="order-q">
        Buscar pedido por email do aluno, curso ou id
      </label>
      <Input
        id="order-q"
        name="q"
        type="search"
        defaultValue={params.q}
        placeholder="Email, curso ou id do pedido"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={100}
      />
      <Button type="submit" variant="secondary">
        Buscar
      </Button>
    </form>
  );
}

export function OrdersFilters({ basePath, params }: { basePath: string; params: OrderListParams }) {
  const none = params.status === null && !params.refundQueue;
  const chip = (active: boolean) => (active ? `${styles.chip} ${styles.chipActive}` : styles.chip);
  return (
    <nav aria-label="Filtrar pedidos" className={styles.filters}>
      <Link
        className={chip(none)}
        aria-current={none ? 'page' : undefined}
        href={ordersHref(basePath, { q: params.q })}
      >
        Todos
      </Link>
      <Link
        className={chip(params.refundQueue)}
        aria-current={params.refundQueue ? 'page' : undefined}
        href={ordersHref(basePath, { q: params.q, refundQueue: true })}
      >
        Fila de reembolso
      </Link>
      {ORDER_STATUSES.map((s) => (
        <Link
          key={s}
          className={chip(params.status === s)}
          aria-current={params.status === s ? 'page' : undefined}
          href={ordersHref(basePath, { q: params.q, status: s })}
        >
          {STATUS_LABELS[s]}
        </Link>
      ))}
    </nav>
  );
}

/** Tabela (cartões no mobile) + paginação + vazio. Puro: serve à página e à vitrine. */
export function OrdersList({
  rows,
  total,
  params,
  basePath,
}: {
  rows: AdminOrderListItem[];
  total: number;
  params: OrderListParams;
  basePath: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={
          params.refundQueue
            ? 'Fila de reembolso vazia'
            : params.q
              ? 'Nenhum pedido encontrado'
              : 'Nenhum pedido'
        }
        description={
          params.refundQueue
            ? 'Quando um aluno pedir reembolso, o pedido aparece aqui.'
            : params.q
              ? `Nada para “${params.q}” neste filtro. Confira o email, o curso ou o id.`
              : 'Os pedidos aparecem aqui assim que alguém iniciar uma compra.'
        }
      />
    );
  }

  const columns: TableColumn<AdminOrderListItem>[] = [
    {
      key: 'order',
      header: 'Pedido',
      render: (o) => (
        <span className={styles.cell}>
          <Link className={styles.link} href={`${basePath}/${o.id}`}>
            {o.courseTitle}
          </Link>
          <span className={styles.dim}>{formatDate(o.createdAt)}</span>
        </span>
      ),
    },
    {
      key: 'student',
      header: 'Aluno',
      render: (o) => (
        <span className={styles.cell}>
          <span>{o.studentName || 'Sem nome'}</span>
          <span className={styles.dim}>{o.studentEmail ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <span className={styles.cell}>
          <Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge>
          {o.status === 'paid' && o.refundRequestedAt ? (
            <span className={styles.dim}>
              Reembolso pedido em {formatDate(o.refundRequestedAt)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      render: (o) => (
        <span className={styles.cell}>
          <span>{formatBRL(o.amountCents)}</span>
          <span className={styles.dim}>{paymentMethodLabel(o.source, o.paymentMethod)}</span>
        </span>
      ),
      align: 'end',
    },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <p className={styles.dim} aria-live="polite">
        {total} {total === 1 ? 'pedido' : 'pedidos'}
        {params.q ? ` para “${params.q}”` : ''}
      </p>
      <Table caption="Pedidos" columns={columns} rows={rows} getRowKey={(o) => o.id} />
      <Pagination
        page={params.page}
        pageCount={pageCount}
        buildHref={(p) => ordersHref(basePath, params, p)}
        label="Paginação de pedidos"
      />
    </>
  );
}
