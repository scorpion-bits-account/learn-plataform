'use client';

import { useId, useState } from 'react';

import { IconButton } from '@/components/ui';

import type { EditorMaterial } from '@/features/materials/model';

import type { CurriculumModule } from '../queries';
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, PencilIcon, TrashIcon } from './icons';
import styles from './CurriculumEditor.module.css';
import { LessonItem } from './LessonItem';
import { TitleForm } from './TitleForm';

interface Props {
  courseId: string;
  module: CurriculumModule;
  materials: Record<string, EditorMaterial[]>;
  openLessonId: string | null;
  onToggleLesson: (lessonId: string) => void;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRename: (title: string) => Promise<string | null>;
  onDelete: () => void;
  onAddLesson: (title: string) => Promise<string | null>;
  onMoveLesson: (index: number, delta: -1 | 1) => void;
  onRenameLesson: (lessonId: string, title: string) => Promise<string | null>;
  onPreview: (lessonId: string, value: boolean) => void;
  onDuration: (lessonId: string, minutes: number | null) => Promise<string | null>;
  onDeleteLesson: (lessonId: string) => void;
}

export function ModuleItem({
  courseId,
  module,
  materials,
  openLessonId,
  onToggleLesson,
  index,
  count,
  open,
  onToggle,
  onMove,
  onRename,
  onDelete,
  onAddLesson,
  onMoveLesson,
  onRenameLesson,
  onPreview,
  onDuration,
  onDeleteLesson,
}: Props) {
  const panelId = useId();
  const [renaming, setRenaming] = useState(false);
  const lessonCount = module.lessons.length;
  const renameId = `rename-module-${module.id}`;

  function closeRename() {
    setRenaming(false);
    requestAnimationFrame(() => document.getElementById(renameId)?.focus());
  }

  return (
    <li className={styles.module}>
      <div className={styles.moduleHead}>
        {renaming ? (
          <TitleForm
            label={`Novo título do módulo ${index + 1}`}
            submitLabel="Salvar"
            initialValue={module.title}
            autoFocus
            onSubmit={onRename}
            onCancel={closeRename}
            onDone={closeRename}
          />
        ) : (
          <h3 className={styles.moduleHeading}>
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
            >
              <span className={styles.chevron} data-open={open} aria-hidden="true">
                <ChevronIcon />
              </span>
              <span className={styles.moduleTitle}>
                <span className={styles.number}>{index + 1}.</span> {module.title}
              </span>
              <span className={styles.count}>
                {lessonCount === 1 ? '1 aula' : `${lessonCount} aulas`}
              </span>
            </button>
          </h3>
        )}
        <div className={styles.actions}>
          <IconButton
            id={`move-module-${module.id}-up`}
            aria-label={`Mover módulo "${module.title}" para cima`}
            icon={<ArrowUpIcon />}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          />
          <IconButton
            id={`move-module-${module.id}-down`}
            aria-label={`Mover módulo "${module.title}" para baixo`}
            icon={<ArrowDownIcon />}
            disabled={index === count - 1}
            onClick={() => onMove(index, 1)}
          />
          <IconButton
            id={renameId}
            aria-label={`Renomear módulo "${module.title}"`}
            icon={<PencilIcon />}
            aria-expanded={renaming}
            onClick={() => setRenaming(true)}
          />
          <IconButton
            aria-label={`Excluir módulo "${module.title}"`}
            icon={<TrashIcon />}
            onClick={onDelete}
          />
        </div>
      </div>

      <div id={panelId} className={styles.modulePanel} hidden={!open}>
        {lessonCount === 0 ? (
          <p className={styles.hint}>Este módulo ainda não tem aulas.</p>
        ) : (
          <ol className={styles.lessons} aria-label={`Aulas do módulo "${module.title}"`}>
            {module.lessons.map((lesson, i) => (
              <LessonItem
                key={lesson.id}
                courseId={courseId}
                lesson={lesson}
                materials={materials[lesson.id] ?? []}
                open={openLessonId === lesson.id}
                onToggle={() => onToggleLesson(lesson.id)}
                number={`${index + 1}.${i + 1}`}
                index={i}
                count={lessonCount}
                onMove={onMoveLesson}
                onRename={(title) => onRenameLesson(lesson.id, title)}
                onPreview={(value) => onPreview(lesson.id, value)}
                onDuration={(minutes) => onDuration(lesson.id, minutes)}
                onDelete={() => onDeleteLesson(lesson.id)}
              />
            ))}
          </ol>
        )}
        <TitleForm
          label={`Título da nova aula em "${module.title}"`}
          placeholder="Título da nova aula"
          submitLabel="Adicionar aula"
          resetOnSuccess
          onSubmit={onAddLesson}
        />
      </div>
    </li>
  );
}
