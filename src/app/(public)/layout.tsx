import type { ReactNode } from 'react';

import { IsoBackdrop } from '@/components/brand';
import { PublicShell } from '@/components/layout';
import { ViewerProvider } from '@/features/viewer/ViewerProvider';

/**
 * Páginas públicas em cache (ISR): o layout NÃO lê cookies. Quem está logado é
 * resolvido no navegador (`ViewerProvider`): troca "Entrar/Criar conta" por
 * "Minha biblioteca" e marca cursos já comprados. É UX, não autorização.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <ViewerProvider>
      <IsoBackdrop variant="full" />
      <PublicShell>{children}</PublicShell>
    </ViewerProvider>
  );
}
