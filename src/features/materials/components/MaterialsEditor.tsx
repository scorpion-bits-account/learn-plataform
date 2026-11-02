'use client';

import { useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from 'react';

import { Button, Dialog, EmptyState, useToast } from '@/components/ui';
import { moveItem } from '@/features/curriculum/order';

import { deleteMaterial, reorderMaterials } from '../actions';
import type { EditorMaterial } from '../queries';
import { MATERIAL_TYPE_LABELS } from '../schemas';
import { LazyMaterialForm } from './LazyMaterialForm';
import { MaterialItem, materialLabel } from './MaterialItem';
import styles from './MaterialsEditor.module.css';

interface Props {
  courseId: string;
  lessonId: string;
  materials: EditorMaterial[];
  /** Nível dos títulos internos (3 na tela da aula; 4 dentro da Ementa). */
  headingLevel?: 3 | 4;
}

function reduce(materials: EditorMaterial[], ids: string[]): EditorMaterial[] {
  const map = new Map(materials.map((m) => [m.id, m]));
  return ids.map((id) => map.get(id)).filter((m): m is EditorMaterial => m !== undefined);
}

/**
 * Editor de materiais da aula. Reordenar é otimista (`useOptimistic`): a lista muda no
 * clique e volta sozinha, com toast, se a action falhar. Criar, editar e excluir esperam o
 * servidor e atualizam por revalidação.
 */
export function MaterialsEditor({
  courseId,
  lessonId,
  materials: initial,
  headingLevel = 3,
}: Props) {
  const Heading = `h${headingLevel}` as const;
  const headingId = useId();
  const { toast } = useToast();
  const [materials, applyOrder] = useOptimistic(initial, reduce);
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const focusId = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Mover um item recria seu nó no DOM e o navegador perde o foco: devolvemos aqui.
  useLayoutEffect(() => {
    if (!focusId.current) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  });

  function move(index: number, delta: -1 | 1) {
    const moved = materials[index];
    const next = moveItem(materials, index, delta);
    if (!moved || next.every((item, i) => item === materials[i])) return;
    const ids = next.map((item) => item.id);
    const newIndex = index + delta;
    // No limite da lista o botão fica desabilitado: o foco vai para o botão oposto.
    const dir =
      delta < 0
        ? newIndex === 0
          ? 'down'
          : 'up'
        : newIndex === materials.length - 1
          ? 'up'
          : 'down';
    focusId.current = `move-material-${moved.id}-${dir}`;
    setAnnouncement(
      `"${materialLabel(moved, index + 1)}" movido para a posição ${newIndex + 1} de ${materials.length}.`,
    );

    startTransition(async () => {
      applyOrder(ids);
      const result = await reorderMaterials({ lessonId, ids });
      if (!result.ok) {
        toast({
          tone: 'error',
          title: 'Não foi possível reordenar',
          description: result.error,
          duration: 10000,
        });
        setAnnouncement('Não foi possível reordenar. A ordem anterior foi restaurada.');
      }
    });
  }

  function closeEdit() {
    const id = editingId;
    setEditingId(null);
    if (id) requestAnimationFrame(() => document.getElementById(`edit-material-${id}`)?.focus());
  }

  const target = materials.find((m) => m.id === targetId);
  const targetNumber = target ? materials.indexOf(target) + 1 : 0;

  function closeDialog() {
    setTargetId(null);
    setDeleteError(null);
  }

  function confirmDelete() {
    if (!target) return;
    const id = target.id;
    startDeleting(async () => {
      const result = await deleteMaterial({ id });
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setTargetId(null);
      setDeleteError(null);
      if (editingId === id) setEditingId(null);
      toast({ tone: 'success', title: 'Material excluído' });
      // O botão que abriu o diálogo deixou de existir: o foco vai para o editor.
      requestAnimationFrame(() => rootRef.current?.focus());
    });
  }

  return (
    <div className={styles.root} ref={rootRef} tabIndex={-1}>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {materials.length === 0 ? (
        <EmptyState
          headingLevel={headingLevel}
          title="Esta aula ainda não tem materiais"
          description="Adicione um vídeo, texto, arquivo ou link no formulário abaixo."
        />
      ) : (
        <ol className={styles.list} aria-label="Materiais da aula">
          {materials.map((material, index) => (
            <MaterialItem
              key={material.id}
              courseId={courseId}
              lessonId={lessonId}
              material={material}
              number={index + 1}
              index={index}
              count={materials.length}
              editing={editingId === material.id}
              onMove={move}
              onEdit={() => setEditingId(editingId === material.id ? null : material.id)}
              onEditDone={closeEdit}
              onDelete={() => setTargetId(material.id)}
            />
          ))}
        </ol>
      )}

      <section className={styles.add} aria-labelledby={headingId}>
        <Heading id={headingId} className={styles.addHeading}>
          Novo material
        </Heading>
        <LazyMaterialForm
          key={formKey}
          courseId={courseId}
          lessonId={lessonId}
          onDone={() => setFormKey((k) => k + 1)}
        />
      </section>

      <Dialog
        open={Boolean(target)}
        onClose={closeDialog}
        title="Excluir material?"
        description={
          target
            ? `${MATERIAL_TYPE_LABELS[target.type]} "${materialLabel(target, targetNumber)}" será removido da aula${target.type === 'file' ? ' e o arquivo enviado será apagado do armazenamento' : ''}.`
            : ''
        }
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" disabled={deleting} onClick={closeDialog}>
              Cancelar
            </Button>
            <Button variant="danger" pending={deleting} onClick={confirmDelete}>
              Excluir
            </Button>
          </>
        }
      >
        <p className={styles.warning}>Essa ação não pode ser desfeita.</p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
