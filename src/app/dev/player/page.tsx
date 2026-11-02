import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PlayerView } from '@/features/player/components/PlayerView';
import {
  MOCK_ALL_COMPLETED_IDS,
  MOCK_COMPLETED_IDS,
  MOCK_COURSE,
  MOCK_COURSE_MATERIALS,
  MOCK_MATERIALS,
  MOCK_MODULES,
} from '@/features/player/mock';
import { buildOutlineView, flattenOutline, resolveNeighbors } from '@/features/player/model';

export const metadata: Metadata = {
  title: 'Vitrine · player de aulas',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Vitrine do player (STUDENT-005/006) com dados fictícios; 404 em produção.
 * `?lesson=mock-lesson-N` escolhe a aula · `?state=preview` (sem compra: só prévias abrem;
 * `lesson=mock-lesson-3` mostra o convite ao curso) · `?state=empty` (aula sem materiais) · `?state=no-course-materials` (sem a seção "Materiais do curso") ·
 * `?state=done` (aula atual concluída, oferece a próxima) · `?state=course-done` (todas concluídas) ·
 * `?demo=fail` (o "Concluir" falha e faz rollback; padrão: simula sucesso).
 */
export default async function PlayerShowcasePage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();

  const params = await searchParams;
  const state = first(params.state);
  const lessons = flattenOutline(MOCK_MODULES);
  const requested = first(params.lesson);
  const lesson = lessons.find((l) => l.id === requested) ?? lessons[1]!;

  const hasAccess = state !== 'preview';
  const access = { hasAccess, coursePublished: true };
  const hrefFor = (id: string) => `/dev/player?lesson=${id}${state ? `&state=${state}` : ''}`;
  const link = (l: ReturnType<typeof flattenOutline>[number] | null) =>
    l ? { href: hrefFor(l.id), title: l.title } : null;
  const neighbors = resolveNeighbors(lessons, lesson.id, access);
  const base =
    state === 'course-done'
      ? MOCK_ALL_COMPLETED_IDS
      : state === 'done'
        ? [...MOCK_COMPLETED_IDS, lesson.id]
        : MOCK_COMPLETED_IDS;
  const completedIds = new Set(hasAccess ? base : []);
  const canOpen = hasAccess || lesson.isPreview;

  return (
    <PlayerView
      course={MOCK_COURSE}
      lesson={lesson}
      totalLessons={lessons.length}
      completedCount={completedIds.size}
      lessonCompleted={completedIds.has(lesson.id)}
      demo={first(params.demo) === 'fail' ? 'fail' : 'ok'}
      outline={buildOutlineView(MOCK_MODULES, {
        currentId: lesson.id,
        access,
        completedIds,
        hrefFor,
      })}
      materials={canOpen && state !== 'empty' ? MOCK_MATERIALS : []}
      courseMaterials={
        canOpen && state !== 'empty' && state !== 'no-course-materials' ? MOCK_COURSE_MATERIALS : []
      }
      canOpen={canOpen}
      hasAccess={hasAccess}
      prev={link(neighbors.prev)}
      next={link(neighbors.next)}
      backHref="/dev/brand"
      courseHref="/dev/catalog"
    />
  );
}
