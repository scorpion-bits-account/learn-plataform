import type { ReactNode } from 'react';

import { IsoBackdrop } from '@/components/brand';

/**
 * Prévia de aula para visitante (sem login). Fora de `(student)` porque aquele layout
 * exige sessão; quem já está logado é mandado para `/aprender/...` pela página.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <IsoBackdrop variant="full" />
      {children}
    </>
  );
}
