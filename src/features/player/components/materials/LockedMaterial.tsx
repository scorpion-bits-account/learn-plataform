import Link from 'next/link';

import { LockIcon } from '../icons';

import styles from './Materials.module.css';

export interface LockedMaterialProps {
  kind: 'file' | 'link';
  title: string | null;
  /** `/cursos/[slug]/acesso`: cria conta, vai para a compra ou volta ao curso. */
  href: string;
}

/**
 * Arquivo/link da prévia para quem não comprou: mesmo card dos materiais, com cadeado.
 * O endereço real não chega ao navegador (`lockForPreview`).
 */
export function LockedMaterial({ kind, title, href }: LockedMaterialProps) {
  const fallback = kind === 'file' ? 'Arquivo do curso' : 'Link do curso';
  return (
    <Link className={`${styles.card} ${styles.linkCard} ${styles.lockedCard}`} href={href}>
      <span className={styles.cardIcon} aria-hidden="true">
        <LockIcon />
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle}>{title ?? fallback}</span>
        <span className={styles.cardMeta}>Disponível para quem comprou o curso</span>
      </span>
    </Link>
  );
}
