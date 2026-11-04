import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CatalogLive } from '@/features/catalog/components/CatalogLive';
import { CatalogView } from '@/features/catalog/components/CatalogView';
import { withCover } from '@/features/catalog/presenters';
import { getCatalog } from '@/features/catalog/queries';

export const metadata: Metadata = {
  title: 'Cursos',
  description: 'Catálogo de cursos de game dev da Scorpion Bits: filtre por categoria e nível.',
  alternates: { canonical: '/cursos' },
};

/** Igual para todos: cache de 5 min. Filtros da URL são aplicados no navegador. */
export const revalidate = 300;

export default async function CatalogPage() {
  const { courses, categories } = await getCatalog();
  const all = courses.map(withCover);

  return (
    <Suspense
      fallback={
        <CatalogView courses={all} categories={categories} filters={{}} ownedCourseIds={[]} />
      }
    >
      <CatalogLive courses={all} categories={categories} />
    </Suspense>
  );
}
