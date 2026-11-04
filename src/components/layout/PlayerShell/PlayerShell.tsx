'use client';

import Link from 'next/link';
import { useId, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { CubeProgress } from '@/components/brand';
import { Drawer } from '@/components/ui';

import { BackIcon, ListIcon, SidebarIcon } from '../icons';
import { SkipLink } from '../SkipLink/SkipLink';
import { MAIN_ID } from '../types';

import styles from './PlayerShell.module.css';

export interface PlayerShellProps {
  /** Destino do "voltar" (ex.: /minha-biblioteca). */
  backHref: string;
  backLabel?: string;
  courseTitle: string;
  /** Progresso do curso (aulas concluídas / total). */
  progress: { total: number; completed: number };
  /** Ementa (módulos e aulas). Renderizada na lateral (>= 1024px) e no Drawer (mobile). */
  outline: ReactNode;
  /** Título do painel da ementa. */
  outlineTitle?: string;
  /** Slots da barra de ações: fixa embaixo no mobile, ao fim do conteúdo no desktop. */
  prev?: ReactNode;
  complete?: ReactNode;
  next?: ReactNode;
  /** Aula (vídeo, texto, materiais). */
  children: ReactNode;
}

/**
 * Player em tela cheia (100dvh): topo fino, conteúdo central (máx. 960px),
 * ementa lateral recolhível (desktop) ou Drawer bottom-sheet aberto por
 * "Aulas" (mobile), e barra inferior com Anterior / Concluir / Próxima.
 * Recebe tudo por props/slots; não busca dados.
 */
/*
 * Modo cinema (ementa oculta, vídeo maior) lembrado entre aulas neste navegador.
 * Memória do módulo como fonte; localStorage só para persistir (pode estar bloqueado).
 */
const CINEMA_KEY = 'sbl-player-cinema';
const cinemaListeners = new Set<() => void>();
let cinemaMemory: boolean | null = null;

function readCinema(): boolean {
  if (cinemaMemory === null) {
    try {
      cinemaMemory = window.localStorage.getItem(CINEMA_KEY) === '1';
    } catch {
      cinemaMemory = false;
    }
  }
  return cinemaMemory;
}

function writeCinema(value: boolean): void {
  cinemaMemory = value;
  try {
    if (value) window.localStorage.setItem(CINEMA_KEY, '1');
    else window.localStorage.removeItem(CINEMA_KEY);
  } catch {
    // sem armazenamento: só não lembra na próxima visita
  }
  cinemaListeners.forEach((listener) => listener());
}

function subscribeCinema(listener: () => void): () => void {
  cinemaListeners.add(listener);
  return () => cinemaListeners.delete(listener);
}

export function PlayerShell({
  backHref,
  backLabel = 'Voltar à biblioteca',
  courseTitle,
  progress,
  outline,
  outlineTitle = 'Aulas do curso',
  prev,
  complete,
  next,
  children,
}: PlayerShellProps) {
  const cinema = useSyncExternalStore(subscribeCinema, readCinema, () => false);
  const asideOpen = !cinema;
  const setAsideOpen = (update: (open: boolean) => boolean) => writeCinema(!update(asideOpen));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const asideId = useId();
  const hasActions = Boolean(prev || complete || next);

  // navegar por um link da ementa fecha o Drawer
  const onDrawerClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a[href]')) setDrawerOpen(false);
  };

  return (
    <div className={styles.shell} data-cinema={asideOpen ? undefined : ''}>
      <SkipLink />
      <header className={styles.top}>
        <Link href={backHref} className={styles.back} aria-label={backLabel}>
          <BackIcon />
        </Link>
        <p className={styles.title} title={courseTitle}>
          {courseTitle}
        </p>
        <CubeProgress
          className={styles.progress}
          size="sm"
          maxVisible={6}
          total={progress.total}
          completed={progress.completed}
          label={`Progresso em ${courseTitle}`}
        />
        <button
          type="button"
          className={`${styles.toggle} ${styles.toggleMobile}`}
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
        >
          <ListIcon />
          <span>Aulas</span>
        </button>
        <button
          type="button"
          className={`${styles.toggle} ${styles.toggleDesktop}`}
          onClick={() => setAsideOpen((value) => !value)}
          aria-pressed={!asideOpen}
          aria-controls={asideId}
          title="Oculta a ementa e aumenta o vídeo (melhora a qualidade do YouTube)"
        >
          <SidebarIcon />
          <span>Modo cinema</span>
        </button>
      </header>

      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
      <aside id={asideId} className={styles.aside} aria-label="Ementa do curso" hidden={!asideOpen}>
        <h2 className={styles.asideTitle}>{outlineTitle}</h2>
        {outline}
      </aside>
      {hasActions && (
        <div className={styles.actions} role="region" aria-label="Navegação da aula">
          <div className={styles.actionsInner}>
            {prev}
            {complete}
            {next}
          </div>
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={outlineTitle}>
        <div onClick={onDrawerClick}>{outline}</div>
      </Drawer>
    </div>
  );
}
