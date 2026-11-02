'use client';

import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from 'react';

import { Button, Dialog, EmptyState, useToast } from '@/components/ui';
import type { EditorMaterial } from '@/features/materials/model';
import type { ActionResult } from '@/lib/auth/actions';

import {
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  renameLesson,
  renameModule,
  reorderLessons,
  reorderModules,
  setLessonDuration,
  setLessonPreview,
} from '../actions';
import { toggleLesson, withOpenLesson } from '../expansion';
import { moveItem } from '../order';
import type { CurriculumModule } from '../queries';
import styles from './CurriculumEditor.module.css';
import { ModuleItem } from './ModuleItem';
import { TitleForm } from './TitleForm';

type Op =
  | { type: 'order-modules'; ids: string[] }
  | { type: 'order-lessons'; moduleId: string; ids: string[] }
  | { type: 'preview'; lessonId: string; value: boolean };

function byIds<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const map = new Map(list.map((item) => [item.id, item]));
  return ids.map((id) => map.get(id)).filter((item): item is T => item !== undefined);
}

function reduce(modules: CurriculumModule[], op: Op): CurriculumModule[] {
  switch (op.type) {
    case 'order-modules':
      return byIds(modules, op.ids);
    case 'order-lessons':
      return modules.map((m) =>
        m.id === op.moduleId ? { ...m, lessons: byIds(m.lessons, op.ids) } : m,
      );
    case 'preview':
      return modules.map((m) => ({
        ...m,
        lessons: m.lessons.map((l) => (l.id === op.lessonId ? { ...l, isPreview: op.value } : l)),
      }));
  }
}

type Target = { kind: 'module' | 'lesson'; id: string };

/** Mensagem de erro para exibir junto ao campo: erro do título ou o geral. */
function messageOf(result: ActionResult<unknown>): string | null {
  if (result.ok) return null;
  return result.fieldErrors?.title?.[0] ?? result.error;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

interface Props {
  courseId: string;
  modules: CurriculumModule[];
  /** Materiais de todas as aulas do curso, por `lessonId`. */
  materials: Record<string, EditorMaterial[]>;
  /** Aula aberta na URL (`?aula=`) ao carregar a página. */
  initialOpenLessonId?: string | null;
}

/**
 * Editor da ementa. Reordenar e alternar prévia são otimistas (`useOptimistic`):
 * a tela muda no clique e volta sozinha, com toast, se a action falhar. Criar,
 * renomear, excluir e salvar duração esperam o servidor e atualizam via revalidação.
 */
export function CurriculumEditor({
  courseId,
  modules: initial,
  materials,
  initialOpenLessonId = null,
}: Props) {
  const { toast } = useToast();
  const [modules, apply] = useOptimistic(initial, reduce);
  const [, startTransition] = useTransition();
  const [openLessonId, setOpenLessonId] = useState<string | null>(initialOpenLessonId);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
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

  function failure(title: string, result: ActionResult<unknown>) {
    if (result.ok) return;
    toast({ tone: 'error', title, description: result.error, duration: 10000 });
  }

  /** Move um item de uma lista otimista e persiste a nova ordem. */
  function reorder(config: {
    kind: 'module' | 'lesson';
    list: { id: string; title: string }[];
    index: number;
    delta: -1 | 1;
    op: (ids: string[]) => Op;
    persist: (ids: string[]) => Promise<ActionResult<unknown>>;
  }) {
    const { kind, list, index, delta } = config;
    const moved = list[index];
    const next = moveItem(list, index, delta);
    if (!moved || next.every((item, i) => item === list[i])) return;
    const ids = next.map((item) => item.id);
    const newIndex = index + delta;
    // No limite da lista o botão fica desabilitado: o foco vai para o botão oposto.
    const dir =
      delta < 0 ? (newIndex === 0 ? 'down' : 'up') : newIndex === list.length - 1 ? 'up' : 'down';
    focusId.current = `move-${kind}-${moved.id}-${dir}`;
    const label = kind === 'module' ? 'Módulo' : 'Aula';
    setAnnouncement(
      `${label} "${moved.title}" movido para a posição ${newIndex + 1} de ${list.length}.`,
    );

    startTransition(async () => {
      apply(config.op(ids));
      const result = await config.persist(ids);
      if (!result.ok) {
        failure('Não foi possível reordenar', result);
        setAnnouncement('Não foi possível reordenar. A ordem anterior foi restaurada.');
      }
    });
  }

  function moveModule(index: number, delta: -1 | 1) {
    reorder({
      kind: 'module',
      list: modules,
      index,
      delta,
      op: (ids) => ({ type: 'order-modules', ids }),
      persist: (ids) => reorderModules({ courseId, ids }),
    });
  }

  function moveLesson(module: CurriculumModule, index: number, delta: -1 | 1) {
    reorder({
      kind: 'lesson',
      list: module.lessons,
      index,
      delta,
      op: (ids) => ({ type: 'order-lessons', moduleId: module.id, ids }),
      persist: (ids) => reorderLessons({ moduleId: module.id, ids }),
    });
  }

  function togglePreview(lessonId: string, value: boolean) {
    startTransition(async () => {
      apply({ type: 'preview', lessonId, value });
      const result = await setLessonPreview({ id: lessonId, isPreview: value });
      failure('Não foi possível alterar a prévia', result);
    });
  }

  /** Abre/fecha a aula e espelha na URL sem navegar (sobrevive a recarregar e a salvar). */
  function showLesson(lessonId: string | null) {
    setOpenLessonId(lessonId);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${withOpenLesson(window.location.search, lessonId)}`,
    );
  }

  function toggleOpen(id: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /* ------------------------------------------------------------- exclusão */

  const targetModule =
    target?.kind === 'module' ? modules.find((m) => m.id === target.id) : undefined;
  const targetLesson =
    target?.kind === 'lesson'
      ? modules.flatMap((m) => m.lessons).find((l) => l.id === target.id)
      : undefined;
  const dialogOpen = Boolean(targetModule ?? targetLesson);

  function closeDialog() {
    setTarget(null);
    setDeleteError(null);
  }

  function confirmDelete() {
    if (!target) return;
    const current = target;
    startDeleting(async () => {
      const result =
        current.kind === 'module'
          ? await deleteModule({ id: current.id })
          : await deleteLesson({ id: current.id });
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setTarget(null);
      setDeleteError(null);
      if (current.kind === 'lesson' && current.id === openLessonId) showLesson(null);
      toast({
        tone: 'success',
        title: current.kind === 'module' ? 'Módulo excluído' : 'Aula excluída',
      });
      // O botão que abriu o diálogo deixou de existir: o foco vai para o editor.
      requestAnimationFrame(() => rootRef.current?.focus());
    });
  }

  function deleteSummary(): string {
    if (targetModule) {
      const lessons = targetModule.lessons.length;
      const materials = targetModule.lessons.reduce((sum, l) => sum + l.materialCount, 0);
      return `O módulo "${targetModule.title}" será apagado com ${plural(lessons, 'aula', 'aulas')} e ${plural(materials, 'material', 'materiais')}, incluindo arquivos enviados e o progresso dos alunos nessas aulas.`;
    }
    if (targetLesson) {
      return `A aula "${targetLesson.title}" será apagada com ${plural(targetLesson.materialCount, 'material', 'materiais')}, incluindo arquivos enviados e o progresso dos alunos nela.`;
    }
    return '';
  }

  /* --------------------------------------------------------------- render */

  return (
    <div className={styles.root} ref={rootRef} tabIndex={-1}>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {modules.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="Este curso ainda não tem módulos"
          description="Crie o primeiro módulo abaixo e depois adicione as aulas dentro dele."
        />
      ) : (
        <ol className={styles.modules} aria-label="Módulos do curso">
          {modules.map((module, index) => (
            <ModuleItem
              key={module.id}
              courseId={courseId}
              module={module}
              index={index}
              count={modules.length}
              open={!closed.has(module.id)}
              onToggle={() => toggleOpen(module.id)}
              onMove={moveModule}
              onRename={async (title) => messageOf(await renameModule({ id: module.id, title }))}
              onDelete={() => setTarget({ kind: 'module', id: module.id })}
              materials={materials}
              openLessonId={openLessonId}
              onToggleLesson={(lessonId) => showLesson(toggleLesson(openLessonId, lessonId))}
              onAddLesson={async (title) => {
                const result = await createLesson({ moduleId: module.id, title });
                // A aula nova já abre expandida para receber o conteúdo.
                if (result.ok) showLesson(result.data.id);
                return messageOf(result);
              }}
              onMoveLesson={(i, delta) => moveLesson(module, i, delta)}
              onRenameLesson={async (id, title) => messageOf(await renameLesson({ id, title }))}
              onPreview={togglePreview}
              onDuration={async (id, minutes) => {
                const result = await setLessonDuration({ id, minutes });
                return result.ok ? null : (result.fieldErrors?.minutes?.[0] ?? result.error);
              }}
              onDeleteLesson={(id) => setTarget({ kind: 'lesson', id })}
            />
          ))}
        </ol>
      )}

      <section className={styles.addModule} aria-labelledby="add-module-heading">
        <h3 id="add-module-heading" className={styles.addHeading}>
          Novo módulo
        </h3>
        <TitleForm
          label="Título do novo módulo"
          placeholder="Ex.: Fundamentos da engine"
          submitLabel="Adicionar módulo"
          resetOnSuccess
          onSubmit={async (title) => messageOf(await createModule({ courseId, title }))}
        />
      </section>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={targetModule ? 'Excluir módulo?' : 'Excluir aula?'}
        description={deleteSummary()}
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
        <p className={styles.dialogWarning}>Essa ação não pode ser desfeita.</p>
        {deleteError ? (
          <p className={styles.fieldError} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
