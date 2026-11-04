import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PlayerView } from '@/features/player/components/PlayerView';
import { buildOutlineView, resolveNeighbors } from '@/features/player/model';
import type { FlatLesson } from '@/features/player/model';
import { getPlayerPage } from '@/features/player/queries';
import { getCurrentUser } from '@/lib/auth/dal';

// Leitura por visitante, mas sempre dinâmica (sessão decide o redirect).
export const dynamic = 'force-dynamic';

type Params = Promise<{ courseSlug: string; lessonId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseSlug, lessonId } = await params;
  const data = await getPlayerPage(courseSlug, lessonId, null);
  return {
    title: data ? `Prévia: ${data.lesson.title} · ${data.course.title}` : 'Prévia',
    robots: { index: false, follow: false },
  };
}

/**
 * Aula de prévia aberta para visitante. Logado vai para o player normal (`/aprender`), que
 * abre tudo para quem comprou. Aula que não é prévia leva à tela "você ainda não comprou".
 * Arquivos e links da prévia chegam bloqueados (`lockForPreview`) e a RLS segue decidindo
 * o que o visitante lê.
 */
export default async function PreviewLessonPage({ params }: { params: Params }) {
  const { courseSlug, lessonId } = await params;

  const user = await getCurrentUser();
  if (user) redirect(`/aprender/${encodeURIComponent(courseSlug)}/${encodeURIComponent(lessonId)}`);

  const data = await getPlayerPage(courseSlug, lessonId, null);
  if (!data) notFound();
  const { course, lesson } = data;
  if (!data.canOpen) redirect(`/cursos/${course.slug}/acesso`);

  const access = { hasAccess: false, coursePublished: course.published };
  const hrefFor = (id: string) => `/previa/${course.slug}/${id}`;
  const link = (l: FlatLesson | null) => (l ? { href: hrefFor(l.id), title: l.title } : null);
  const neighbors = resolveNeighbors(data.lessons, lesson.id, access);

  return (
    <PlayerView
      course={course}
      lesson={lesson}
      totalLessons={data.lessons.length}
      completedCount={0}
      lessonCompleted={false}
      outline={buildOutlineView(data.modules, {
        currentId: lesson.id,
        access,
        completedIds: new Set<string>(),
        hrefFor,
      })}
      materials={data.materials}
      courseMaterials={data.courseMaterials}
      canOpen
      hasAccess={false}
      prev={link(neighbors.prev)}
      next={link(neighbors.next)}
      courseHref={`/cursos/${course.slug}`}
    />
  );
}
