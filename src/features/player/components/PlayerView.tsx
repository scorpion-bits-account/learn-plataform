import type { ReactNode } from 'react';

import { Badge, Button, EmptyState } from '@/components/ui';
import { formatDuration } from '@/features/catalog/model';

import type { FlatLesson, OutlineModuleView, PlayerMaterial } from '../model';

import { LessonTitle } from './LessonTitle';
import { LockIcon } from './icons';
import { Materials } from './materials/Materials';
import { PlayerFrame } from './PlayerFrame';
import type { LessonLink } from './PlayerFrame';
import styles from './PlayerView.module.css';

export type { LessonLink };

export interface PlayerViewProps {
  course: { slug: string; title: string };
  lesson: FlatLesson;
  totalLessons: number;
  completedCount: number;
  /** A aula atual está concluída (servidor). */
  lessonCompleted: boolean;
  outline: OutlineModuleView[];
  materials: PlayerMaterial[];
  /** Materiais "em todas as aulas" de outras aulas do curso (seção "Materiais do curso"). */
  courseMaterials?: PlayerMaterial[];
  /** A aula abre (acesso ao curso ou prévia)? Senão mostra o convite para o curso. */
  canOpen: boolean;
  hasAccess: boolean;
  prev: LessonLink | null;
  next: LessonLink | null;
  backHref?: string;
  /** Destino do CTA quando a aula está bloqueada. */
  courseHref: string;
  /** Efeitos sem UI (ex.: registro de retomada). */
  children?: ReactNode;
  /** Só a vitrine `/dev`: simula a gravação do progresso. */
  demo?: 'ok' | 'fail';
}

/**
 * Tela da aula dentro do `PlayerShell`. Server Component: recebe dados prontos e não faz I/O,
 * por isso a mesma tela serve a página real e a vitrine `/dev/player`.
 */
export function PlayerView({
  course,
  lesson,
  totalLessons,
  completedCount,
  lessonCompleted,
  outline,
  materials,
  courseMaterials = [],
  canOpen,
  hasAccess,
  prev,
  next,
  backHref = '/minha-biblioteca',
  courseHref,
  children,
  demo,
}: PlayerViewProps) {
  const duration = formatDuration(lesson.durationSeconds);

  return (
    <PlayerFrame
      backHref={backHref}
      courseTitle={course.title}
      lessonId={lesson.id}
      totalLessons={totalLessons}
      completedCount={completedCount}
      lessonCompleted={lessonCompleted}
      outline={outline}
      showPreviewBadge={!hasAccess}
      canComplete={hasAccess}
      prev={prev}
      next={next}
      demo={demo}
    >
      <article key={lesson.id} aria-labelledby={`${lesson.id}-title`} className={styles.lesson}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>
            Módulo {lesson.moduleNumber} · Aula {lesson.number} de {totalLessons}
          </p>
          <LessonTitle id={`${lesson.id}-title`}>{lesson.title}</LessonTitle>
          <p className={styles.meta}>
            <span>{lesson.moduleTitle}</span>
            {duration ? <span>{duration}</span> : null}
            {lesson.isPreview && !hasAccess ? <Badge tone="mint">Prévia gratuita</Badge> : null}
          </p>
          {lesson.summary ? <p className={styles.summary}>{lesson.summary}</p> : null}
        </header>

        {canOpen ? (
          <Materials
            materials={materials}
            courseMaterials={courseMaterials}
            lockedHref={`${courseHref}/acesso`}
          />
        ) : (
          <EmptyState
            illustration={<LockIcon />}
            title="Esta aula faz parte do curso completo"
            description="Garanta o acesso para assistir a esta aula e a todas as outras. As aulas de prévia continuam abertas."
            action={<Button href={courseHref}>Ver o curso</Button>}
          />
        )}

        <p className={styles.hint}>
          Atalhos: <kbd>[</kbd> aula anterior · <kbd>]</kbd> próxima aula · <kbd>Alt</kbd>+
          <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd>
        </p>
      </article>
      {children}
    </PlayerFrame>
  );
}
