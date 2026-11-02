import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getLessonEditorData } from '@/features/materials/queries';

export const metadata: Metadata = { title: 'Materiais da aula' };

/**
 * Rota legada (links antigos): os materiais agora são editados na própria Ementa.
 * Redireciona para a aula já aberta lá, depois de conferir que ela pertence ao curso da URL.
 */
export default async function LessonMaterialsPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id, lessonId } = await params;
  const data = await getLessonEditorData(id, lessonId);
  // Aula de outro curso (ou inexistente) é 404: o id do curso na URL precisa bater com o da aula.
  if (!data) notFound();
  redirect(`/admin/cursos/${id}?tab=syllabus&aula=${data.lesson.id}`);
}
