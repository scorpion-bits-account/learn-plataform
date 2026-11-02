import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CheckoutView } from '@/features/checkout/components/CheckoutView';
import { getCheckoutPage } from '@/features/checkout/queries';

/*
 * Rota no grupo `(student)/(app)`: o layout `(student)` já chama `requireUser()`
 * (e o proxy manda anônimos para `/entrar?next=/checkout/...`); o StudentShell dá
 * a navegação. A query e a Server Action checam a sessão de novo (layout não
 * protege actions) e a RLS é a barreira final.
 */

export const metadata: Metadata = {
  title: 'Finalizar compra',
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;

export default async function CheckoutPage({ params }: { params: Params }) {
  const { slug } = await params;
  const data = await getCheckoutPage(slug);
  if (!data) notFound();

  return (
    <CheckoutView
      course={data.course}
      hasAccess={data.hasAccess}
      prefill={data.prefill}
      pendingOrderId={data.pendingOrderId}
      pendingMethod={data.pendingMethod}
    />
  );
}
