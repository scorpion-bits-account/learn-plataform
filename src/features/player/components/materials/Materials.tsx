import { EmptyState } from '@/components/ui';

import type { PlayerMaterial } from '../../model';

import { FileMaterial } from './FileMaterial';
import { LinkMaterial } from './LinkMaterial';
import { LockedMaterial } from './LockedMaterial';
import { TextMaterial } from './TextMaterial';
import { VideoMaterial } from './VideoMaterial';
import styles from './Materials.module.css';

const DEFAULT_TITLE = {
  video: 'Vídeo',
  text: 'Texto',
  file: 'Arquivo',
  link: 'Link',
  locked: 'Material do curso',
} as const;

type Level = 2 | 3;

function MaterialList({
  materials,
  level,
  lockedHref,
}: {
  materials: PlayerMaterial[];
  level: Level;
  lockedHref: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.list}>
      {materials.map((material) => {
        const headingId = `material-${material.id}`;
        const title = material.title ?? DEFAULT_TITLE[material.type];
        return (
          <section key={material.id} className={styles.material} aria-labelledby={headingId}>
            <Heading
              id={headingId}
              className={material.title ? styles.heading : `${styles.heading} ${styles.srOnly}`}
            >
              {title}
            </Heading>
            {material.type === 'video' ? (
              <VideoMaterial
                provider={material.provider}
                videoId={material.videoId}
                title={title}
              />
            ) : material.type === 'text' ? (
              <TextMaterial body={material.body} />
            ) : material.type === 'file' ? (
              <FileMaterial
                materialId={material.id}
                fileName={material.fileName}
                fileSize={material.fileSize}
              />
            ) : material.type === 'locked' ? (
              <LockedMaterial kind={material.kind} title={material.title} href={lockedHref} />
            ) : (
              <LinkMaterial url={material.url} title={material.title} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Materiais da aula na ordem do banco. Cada um é uma região nomeada (h2). Os materiais
 * "em todas as aulas" do curso (de outras aulas) vêm numa seção própria ao final; sem eles
 * a seção some. O estado vazio só aparece quando não há nenhum dos dois.
 */
export function Materials({
  materials,
  courseMaterials = [],
  lockedHref,
}: {
  materials: PlayerMaterial[];
  courseMaterials?: PlayerMaterial[];
  /** Destino dos materiais bloqueados da prévia (`/cursos/[slug]/acesso`). */
  lockedHref: string;
}) {
  const hasCourse = courseMaterials.length > 0;

  return (
    <>
      {materials.length > 0 ? (
        <MaterialList materials={materials} level={2} lockedHref={lockedHref} />
      ) : !hasCourse ? (
        <EmptyState
          headingLevel={2}
          title="Esta aula ainda não tem materiais"
          description="Volte em breve: o conteúdo é publicado pela equipe."
        />
      ) : null}
      {hasCourse ? (
        <section className={styles.courseSection} aria-labelledby="course-materials-heading">
          <h2 id="course-materials-heading" className={styles.courseHeading}>
            Materiais do curso
          </h2>
          <p className={styles.courseHint}>Disponíveis em todas as aulas.</p>
          <MaterialList materials={courseMaterials} level={3} lockedHref={lockedHref} />
        </section>
      ) : null}
    </>
  );
}
