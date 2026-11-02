import { ErrorState } from '@/components/ui';
import { getCourseMaterials } from '@/features/materials/queries';

import { getCurriculum } from '../queries';
import { CurriculumEditor } from './CurriculumEditor';

/**
 * Server Component: carrega a ementa e os materiais de todas as aulas (duas consultas, sem
 * N+1) e entrega ao editor. Erro de leitura vira ErrorState.
 */
export async function SyllabusPanel({
  courseId,
  openLessonId,
}: {
  courseId: string;
  /** Aula aberta na URL (`?aula=`), já validada como uuid. */
  openLessonId: string | null;
}) {
  let modules;
  let materials;
  try {
    [modules, materials] = await Promise.all([
      getCurriculum(courseId),
      getCourseMaterials(courseId),
    ]);
  } catch {
    return (
      <ErrorState
        title="Não foi possível carregar a ementa"
        message="Recarregue a página para tentar novamente."
      />
    );
  }
  return (
    <CurriculumEditor
      courseId={courseId}
      modules={modules}
      materials={materials}
      initialOpenLessonId={openLessonId}
    />
  );
}
