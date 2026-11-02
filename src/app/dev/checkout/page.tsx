import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { StudentShell } from '@/components/layout';
import { MOCK_COURSES } from '@/features/catalog/mock';
import { CheckoutSkeleton } from '@/features/checkout/components/CheckoutSkeleton';
import { CheckoutView } from '@/features/checkout/components/CheckoutView';
import { OrderStatusView } from '@/features/checkout/components/OrderStatusView';
import type { CheckoutFormState, MyOrder } from '@/features/checkout/model';

export const metadata: Metadata = {
  title: 'Vitrine · checkout',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ERROR_STATE: CheckoutFormState = {
  status: 'error',
  message: 'Dados inválidos. Revise os campos e tente novamente.',
  fieldErrors: {
    taxId: ['CPF inválido. Confira os números.'],
    phone: ['Telefone inválido. Use DDD + número.'],
  },
};

const PROVIDER_ERROR_STATE: CheckoutFormState = {
  status: 'error',
  message:
    'Não conseguimos gerar o PIX agora. Nenhum valor foi cobrado. Tente novamente em instantes.',
};

// QR fictício (SVG em data URL; só para a vitrine).
const QR = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/>${Array.from(
    { length: 29 * 29 },
    (_, i) => {
      const x = i % 29;
      const y = Math.floor(i / 29);
      const finder = (x < 8 && y < 8) || (x > 20 && y < 8) || (x < 8 && y > 20);
      const on = finder
        ? x % 7 === 0 || y % 7 === 0 || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5)
        : (x * 7 + y * 13 + x * y) % 3 === 0;
      return on ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : '';
    },
  ).join('')}</svg>`,
).toString('base64')}`;

const ORDER: MyOrder = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'pending',
  amountCents: 19700,
  expiresAt: new Date(Date.now() + 47 * 60_000 + 12_000).toISOString(),
  createdAt: new Date(Date.UTC(2026, 9, 8, 20, 30)).toISOString(),
  hasPix: true,
  pixBrCode:
    '00020126580014BR.GOV.BCB.PIX0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913SCORPION BITS6009SAO PAULO62070503***6304ABCD',
  pixQrSrc: QR,
  paymentMethod: 'pix',
  checkoutUrl: null,
  course: { slug: MOCK_COURSES[0]!.slug, title: MOCK_COURSES[0]!.title },
};

/**
 * Vitrine do checkout (PAY-002) com dados fictícios; 404 em produção. O botão
 * "Gerar PIX" chama a action real (exige sessão/env), então use só para layout.
 * `?state=prefill|error|provider-error|pending|owned|free|loading|order|order-paid|order-failed|qr|qr-expired|paid|card|pending-card`.
 */
export default async function CheckoutShowcase({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state } = await searchParams;
  const base = MOCK_COURSES[0]!;
  const course = state === 'free' ? { ...base, priceCents: 0 } : base;
  const prefilled = state === 'prefill' || state === 'pending' || state === 'provider-error';

  let body;
  if (state === 'loading') body = <CheckoutSkeleton />;
  else if (state === 'order' || state === 'qr')
    body = <OrderStatusView order={ORDER} poll={false} />;
  else if (state === 'card')
    body = (
      <OrderStatusView
        order={{
          ...ORDER,
          paymentMethod: 'card',
          hasPix: false,
          pixBrCode: null,
          pixQrSrc: null,
          checkoutUrl: 'https://app.abacatepay.com/pay/bill_vitrine',
        }}
        poll={false}
      />
    );
  else if (state === 'qr-expired')
    body = (
      <OrderStatusView
        order={{ ...ORDER, expiresAt: new Date(Date.UTC(2026, 0, 1)).toISOString() }}
        poll={false}
      />
    );
  else if (state === 'order-paid' || state === 'paid')
    body = (
      <OrderStatusView
        order={{ ...ORDER, status: 'paid', pixBrCode: null, pixQrSrc: null }}
        poll={false}
      />
    );
  else if (state === 'order-failed')
    body = (
      <OrderStatusView
        order={{ ...ORDER, status: 'failed', hasPix: false, pixBrCode: null, pixQrSrc: null }}
        poll={false}
      />
    );
  else
    body = (
      <CheckoutView
        course={course}
        hasAccess={state === 'owned'}
        prefill={
          prefilled
            ? { taxId: '111.444.777-35', phone: '(11) 94002-8922' }
            : {
                taxId: state === 'error' ? '111.444.777-00' : '',
                phone: state === 'error' ? '(11) 84002' : '',
              }
        }
        pendingOrderId={state === 'pending' || state === 'pending-card' ? ORDER.id : null}
        pendingMethod={state === 'pending-card' ? 'card' : 'pix'}
        initialState={
          state === 'error'
            ? ERROR_STATE
            : state === 'provider-error'
              ? PROVIDER_ERROR_STATE
              : undefined
        }
      />
    );

  return <StudentShell user={{ name: 'Ana Souza', email: 'ana@example.com' }}>{body}</StudentShell>;
}
