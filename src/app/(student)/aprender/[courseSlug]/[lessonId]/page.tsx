import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PlayerView } from '@/features/player/components/PlayerView';
import { ResumeTracker } from '@/features/player/components/ResumeTracker';
import { buildOutlineView, resolveNeighbors } from '@/features/player/model';
import type { FlatLesson } from '@/features/player/model';
import { getPlayerPage } from '@/features/player/queries';
import { getCurrentUser, requireUser } from '@/lib/auth/dal';

// Conteúdo pago + progresso do usuário: sempre dinâmico. O Next responde páginas dinâmicas
// com `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`.
export const dynamic = 'force-dynamic';

type Params = Promise<{ courseSlug: string; lessonId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseSlug, lessonId } = await params;
  const user = await getCurrentUser();
  const data = user ? await getPlayerPage(courseSlug, lessonId, user.id) : null;
  return {
    title: data ? `${data.lesson.title} · ${data.course.title}` : 'Aula',
    robots: { index: false, follow: false },
  };
}

export default async function LessonPage({ params }: { params: Params }) {
  const { courseSlug, lessonId } = await params;
  const user = await requireUser();

  const data = await getPlayerPage(courseSlug, lessonId, user.id);
  if (!data) notFound();

  const { course, lesson, hasAccess } = data;
  const access = { hasAccess, coursePublished: course.published };
  const hrefFor = (id: string) => `/aprender/${course.slug}/${id}`;
  const link = (l: FlatLesson | null) => (l ? { href: hrefFor(l.id), title: l.title } : null);

  const neighbors = resolveNeighbors(data.lessons, lesson.id, access);
  const lessonIds = new Set(data.lessons.map((l) => l.id));
  const completedIds = new Set(data.completedIds.filter((id) => lessonIds.has(id)));

  return (
    <PlayerView
      course={course}
      lesson={lesson}
      totalLessons={data.lessons.length}
      completedCount={completedIds.size}
      lessonCompleted={completedIds.has(lesson.id)}
      outline={buildOutlineView(data.modules, {
        currentId: lesson.id,
        access,
        completedIds,
        hrefFor,
      })}
      materials={data.materials}
      courseMaterials={data.courseMaterials}
      canOpen={data.canOpen}
      hasAccess={hasAccess}
      prev={link(neighbors.prev)}
      next={link(neighbors.next)}
      courseHref={`/cursos/${course.slug}`}
    >
      {/* só quem tem matrícula: sem acesso o insert em lesson_progress é barrado pela RLS */}
      {hasAccess ? <ResumeTracker lessonId={lesson.id} /> : null}
    </PlayerView>
  );
}
