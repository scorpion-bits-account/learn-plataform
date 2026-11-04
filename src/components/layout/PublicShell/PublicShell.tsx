import Link from 'next/link';
import type { ReactNode } from 'react';

import { Dock, Logo } from '@/components/brand';
import { Button } from '@/components/ui';
import { company, whatsappUrl } from '@/config/company';
import { AuthSwitch } from '@/features/viewer/ViewerProvider';

import { ActiveDockLink } from '../NavLinks';
import { SkipLink } from '../SkipLink/SkipLink';
import { MAIN_ID } from '../types';
import type { ShellUser } from '../types';

import styles from './PublicShell.module.css';

export interface PublicShellProps {
  /**
   * Usuário logado: troca "Entrar/Criar conta" por "Minha biblioteca".
   * `undefined` (páginas públicas em cache) = decidido no navegador pelo `ViewerProvider`.
   */
  user?: ShellUser | null;
  children: ReactNode;
}

/** Páginas públicas: Dock + <main> + rodapé institucional. */
const libraryAction = (
  <Button href="/minha-biblioteca" size="sm">
    Minha biblioteca
  </Button>
);

const guestActions = (
  <>
    <Button href="/entrar" variant="ghost" size="sm">
      Entrar
    </Button>
    <Button href="/cadastro" size="sm">
      Criar conta
    </Button>
  </>
);

export function PublicShell({ user, children }: PublicShellProps) {
  const actions =
    user === undefined ? (
      <AuthSwitch signedIn={libraryAction} guest={guestActions} />
    ) : user ? (
      libraryAction
    ) : (
      guestActions
    );
  return (
    <div className={styles.shell}>
      <SkipLink />
      <Dock
        brand={<Logo />}
        navLabel="Principal"
        nav={
          <>
            <ActiveDockLink href="/cursos">Cursos</ActiveDockLink>
            <ActiveDockLink href="/#estudio">Sobre</ActiveDockLink>
          </>
        }
        actions={actions}
      />
      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer} aria-label="Rodapé">
        <div className={styles.inner}>
          <div className={styles.brand}>
            <Logo href={null} size="sm" />
            <p className={styles.tag}>Aprenda a criar jogos com quem faz jogos.</p>
          </div>
          <nav aria-label="Rodapé: documentos" className={styles.links}>
            <Link href="/termos">Termos de uso</Link>
            <Link href="/privacidade">Privacidade</Link>
            <a href={`mailto:${company.email}`}>Contato</a>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </nav>
          <p className={styles.legal}>
            © {new Date().getFullYear()} {company.brand} · {company.legalName} · CNPJ {company.cnpj}
            <br />
            {company.address}
          </p>
        </div>
      </footer>
    </div>
  );
}
