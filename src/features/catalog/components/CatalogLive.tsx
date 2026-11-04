'use client';

import { useSearchParams } from 'next/navigation';

import { useViewer } from '@/features/viewer/ViewerProvider';

import type { CategoryOption } from '../model';
import { parseCatalogFilters } from '../schemas';
import { CatalogView } from './CatalogView';
import type { CourseView } from './types';

/**
 * /cursos em cache: os filtros (?categoria=, ?nivel=) são lidos no navegador, e o
 * selo "Na sua biblioteca" vem do `ViewerProvider`. Sem JS, o fallback mostra todos.
 */
export function CatalogLive({
  courses,
  categories,
}: {
  courses: CourseView[];
  categories: CategoryOption[];
}) {
  const params = useSearchParams();
  const { ownedCourseIds } = useViewer();
  const filters = parseCatalogFilters({
    categoria: params.get('categoria') ?? undefined,
    nivel: params.get('nivel') ?? undefined,
  });
  const visible = courses.filter(
    (c) =>
      (!filters.categoria || c.categorySlug === filters.categoria) &&
      (!filters.nivel || c.level === filters.nivel),
  );
  return (
    <CatalogView
      courses={visible}
      categories={categories}
      filters={filters}
      ownedCourseIds={[...ownedCourseIds]}
    />
  );
}
