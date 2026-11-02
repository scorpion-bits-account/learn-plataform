'use client';

import { Badge, IconButton } from '@/components/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  TrashIcon,
} from '@/features/curriculum/components/icons';

import type { EditorMaterial } from '../queries';
import { formatBytes, MATERIAL_TYPE_LABELS, VIDEO_PROVIDER_LABELS } from '../schemas';
import { LazyMaterialForm } from './LazyMaterialForm';
import styles from './MaterialsEditor.module.css';

interface Props {
  courseId: string;
  lessonId: string;
  material: EditorMaterial;
  /** "1" */
  number: number;
  index: number;
  count: number;
  editing: boolean;
  onMove: (index: number, delta: -1 | 1) => void;
  onEdit: () => void;
  onEditDone: () => void;
  onDelete: () => void;
}

const TONES = { video: 'cyan', text: 'violet', file: 'amber', link: 'mint' } as const;

function summary(m: EditorMaterial): string {
  switch (m.type) {
    case 'video':
      return `${VIDEO_PROVIDER_LABELS[m.videoProvider ?? ''] ?? 'Vídeo'} · ${m.videoId ?? ''}`;
    case 'text':
      return (m.body ?? '').trim().split('\n')[0]?.slice(0, 140) ?? '';
    case 'file':
      return `${m.fileName ?? 'arquivo'}${m.fileSize !== null ? ` (${formatBytes(m.fileSize)})` : ''}`;
    case 'link':
      return m.externalUrl ?? '';
  }
}

/** Nome usado nos rótulos acessíveis dos botões. */
export function materialLabel(m: EditorMaterial, number: number): string {
  return m.title?.trim() || `${MATERIAL_TYPE_LABELS[m.type]} ${number}`;
}

export function MaterialItem({
  courseId,
  lessonId,
  material,
  number,
  index,
  count,
  editing,
  onMove,
  onEdit,
  onEditDone,
  onDelete,
}: Props) {
  const label = materialLabel(material, number);

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <div className={styles.itemInfo}>
          <p className={styles.itemTitle}>
            <span className={styles.number}>{number}</span>{' '}
            <Badge tone={TONES[material.type]}>{MATERIAL_TYPE_LABELS[material.type]}</Badge>{' '}
            {material.showInAllLessons ? <Badge tone="neutral">Todas as aulas</Badge> : null}{' '}
            {material.title?.trim() ? <span>{material.title}</span> : null}
          </p>
          <p className={styles.itemSummary}>{summary(material)}</p>
        </div>
        <div className={styles.actions}>
          <IconButton
            id={`move-material-${material.id}-up`}
            size="sm"
            aria-label={`Mover "${label}" para cima`}
            icon={<ArrowUpIcon />}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          />
          <IconButton
            id={`move-material-${material.id}-down`}
            size="sm"
            aria-label={`Mover "${label}" para baixo`}
            icon={<ArrowDownIcon />}
            disabled={index === count - 1}
            onClick={() => onMove(index, 1)}
          />
          <IconButton
            id={`edit-material-${material.id}`}
            size="sm"
            aria-label={`Editar "${label}"`}
            aria-expanded={editing}
            icon={<PencilIcon />}
            onClick={onEdit}
          />
          <IconButton
            size="sm"
            aria-label={`Excluir "${label}"`}
            icon={<TrashIcon />}
            onClick={onDelete}
          />
        </div>
      </div>
      {editing ? (
        <LazyMaterialForm
          courseId={courseId}
          lessonId={lessonId}
          material={material}
          onDone={onEditDone}
          onCancel={onEditDone}
        />
      ) : null}
    </li>
  );
}
