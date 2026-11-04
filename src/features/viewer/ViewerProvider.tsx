'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { ShellUser } from '@/components/layout/types';
import { createClient } from '@/lib/supabase/browser';

/**
 * Quem está vendo a página pública, resolvido NO NAVEGADOR. As páginas públicas são
 * estáticas (cache na Vercel) e iguais para todos; o que depende da sessão (menu de
 * conta, "Na sua biblioteca") é ajustado aqui depois de carregar.
 * É UX, não autorização: checkout, player e RLS continuam decidindo o acesso.
 */
export type Viewer = {
  status: 'loading' | 'guest' | 'user';
  user: ShellUser | null;
  /** Cursos na biblioteca do usuário (vazio para visitante ou enquanto carrega). */
  ownedCourseIds: readonly string[];
};

const LOADING: Viewer = { status: 'loading', user: null, ownedCourseIds: [] };
const GUEST: Viewer = { status: 'guest', user: null, ownedCourseIds: [] };

const ViewerContext = createContext<Viewer>(GUEST);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer>(LOADING);

  useEffect(() => {
    let alive = true;
    const set = (v: Viewer) => {
      if (alive) setViewer(v);
    };
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getClaims();
        const claims = data?.claims;
        if (error || typeof claims?.sub !== 'string') return set(GUEST);

        const email = typeof claims.email === 'string' ? claims.email : '';
        const user: ShellUser = { name: email, email };
        set({ status: 'user', user, ownedCourseIds: [] });

        const { data: rows } = await supabase.from('my_library').select('course_id');
        const ids = (rows ?? []).map((r) => r.course_id).filter((id): id is string => Boolean(id));
        set({ status: 'user', user, ownedCourseIds: ids });
      } catch {
        set(GUEST);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}

/** Troca um trecho conforme há sessão. Enquanto carrega (e no HTML em cache) mostra `guest`. */
export function AuthSwitch({ signedIn, guest }: { signedIn: ReactNode; guest: ReactNode }) {
  const { status } = useViewer();
  return <>{status === 'user' ? signedIn : guest}</>;
}
