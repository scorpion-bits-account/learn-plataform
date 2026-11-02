import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CurriculumEditor } from '@/features/curriculum/components/CurriculumEditor';
import { parseLessonParam } from '@/features/curriculum/expansion';
import type { CurriculumModule } from '@/features/curriculum/queries';
import type { EditorMaterial } from '@/features/materials/model';

export const metadata: Metadata = {
  title: 'Vitrine · ementa do admin',
  robots: { index: false, follow: false },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const MODULES: CurriculumModule[] = [
  {
    id: id(1),
    title: 'Fundamentos da engine',
    position: 0,
    lessons: [
      {
        id: id(11),
        title: 'Instalando o Godot',
        position: 0,
        durationSeconds: 540,
        isPreview: true,
        materialCount: 2,
      },
      {
        id: id(12),
        title: 'Cenas, nós e a primeira janela',
        position: 1,
        durationSeconds: 1260,
        isPreview: false,
        materialCount: 0,
      },
    ],
  },
  {
    id: id(2),
    title: 'Movimento do personagem',
    position: 1,
    lessons: [
      {
        id: id(21),
        title: 'Entrada do jogador e física 2D',
        position: 0,
        durationSeconds: null,
        isPreview: false,
        materialCount: 1,
      },
    ],
  },
];

function material(
  over: Partial<EditorMaterial> & Pick<EditorMaterial, 'id' | 'type'>,
): EditorMaterial {
  return {
    title: null,
    position: 0,
    body: null,
    externalUrl: null,
    videoProvider: null,
    videoId: null,
    fileName: null,
    fileSize: null,
    mimeType: null,
    ...over,
  };
}

const MATERIALS: Record<string, EditorMaterial[]> = {
  [id(11)]: [
    material({
      id: id(101),
      type: 'video',
      title: 'Aula gravada',
      videoProvider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    }),
    material({
      id: id(102),
      type: 'text',
      position: 1,
      title: 'Resumo',
      body: 'Baixe o Godot 4 e abra o gerenciador de projetos.',
    }),
  ],
  [id(21)]: [
    material({
      id: id(103),
      type: 'link',
      title: 'Documentação',
      externalUrl: 'https://docs.godotengine.org',
    }),
  ],
};

/** Vitrine com dados fictícios. `?aula=<uuid>` abre uma aula (ex.: 00000000-0000-4000-8000-000000000011). */
export default async function AdminSyllabusShowcase({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { aula } = await searchParams;
  return (
    <main
      style={{
        maxWidth: '72rem',
        margin: '0 auto',
        padding: 'var(--space-5) var(--space-4)',
        display: 'grid',
        gap: 'var(--space-4)',
      }}
    >
      <h1 style={{ fontSize: 'var(--s-2)' }}>Godot do zero · Ementa</h1>
      <CurriculumEditor
        courseId={id(900)}
        modules={MODULES}
        materials={MATERIALS}
        initialOpenLessonId={parseLessonParam(aula) ?? id(11)}
      />
    </main>
  );
}
