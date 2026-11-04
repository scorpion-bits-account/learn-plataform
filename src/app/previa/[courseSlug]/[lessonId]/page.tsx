import { redirect } from 'next/navigation';

import { courseSlugSchema, lessonIdSchema } from '@/features/player/schemas';
import { getCurrentUser } from '@/lib/auth/dal';

type Params = Promise<{ courseSlug: string; lessonId: string }>;

/**
 * A prévia gratuita exige conta (decisão do produto). Este endereço só existe para links já
 * compartilhados: logado -> a aula no player; visitante -> cadastro, que volta para a aula.
 */
export default async function PreviewRedirect({ params }: { params: Params }) {
  const { courseSlug, lessonId } = await params;
  if (
    !courseSlugSchema.safeParse(courseSlug).success ||
    !lessonIdSchema.safeParse(lessonId).success
  ) {
    redirect('/cursos');
  }
  const lessonPath = `/aprender/${courseSlug}/${lessonId}`;
  const user = await getCurrentUser();
  redirect(user ? lessonPath : `/cadastro?next=${encodeURIComponent(lessonPath)}`);
}
