import { IsoCube } from '@/components/brand';
import { Button, EmptyState } from '@/components/ui';

import type { CategoryOption } from '../model';
import type { CatalogFilters as Filters } from '../schemas';
import { CatalogFilters } from './CatalogFilters';
import { CourseCard } from './CourseCard';
import styles from './CatalogView.module.css';
import type { CourseView } from './types';

export interface CatalogViewProps {
  /** Já filtrados. */
  courses: CourseView[];
  categories: CategoryOption[];
  filters: Filters;
  ownedCourseIds: string[];
  hrefFor?: (filters: Filters) => string;
  clearHref?: string;
}

export function CatalogView({
  courses,
  categories,
  filters,
  ownedCourseIds,
  hrefFor,
  clearHref = '/cursos',
}: CatalogViewProps) {
  const owned = new Set(ownedCourseIds);
  const filtered = Boolean(filters.categoria || filters.nivel);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Catálogo</p>
        <h1 className={styles.title}>Cursos de game dev</h1>
        <p className={styles.lead}>
          Cursos práticos de desenvolvimento de jogos, organizados por área e nível.
        </p>
      </header>

      <CatalogFilters categories={categories} filters={filters} hrefFor={hrefFor} />

      <section aria-labelledby="lista-cursos" className={styles.results}>
        <h2 id="lista-cursos" className={styles.count} aria-live="polite">
          {courses.length === 1 ? '1 curso' : `${courses.length} cursos`}
        </h2>
        {courses.length === 0 ? (
          <EmptyState
            illustration={<IsoCube size={72} state="empty" />}
            title={filtered ? 'Nenhum curso com esses filtros' : 'Novos cursos em breve'}
            description={
              filtered
                ? 'Tente outra categoria ou nível.'
                : 'Estamos preparando os primeiros cursos. Volte em breve.'
            }
            action={
              filtered ? (
                <Button href={clearHref} variant="secondary">
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className={styles.grid}>
            {courses.map((course, i) => (
              <CourseCard
                key={course.id}
                course={course}
                owned={owned.has(course.id)}
                featured={i === 0}
                priority={i < 2}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
