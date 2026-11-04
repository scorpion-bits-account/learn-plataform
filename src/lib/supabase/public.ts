import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

import { getClientEnv } from '@/lib/env/client';
import type { Database } from '@/types/database';

/**
 * Client Supabase SEM cookies, sempre como visitante (anon + RLS), para dados públicos
 * (catálogo, curso, ementa). Não lê a sessão, então as páginas que o usam podem ser
 * estáticas/ISR. Sem env (build de CI) devolve `null` e as leituras ficam vazias.
 */
export function createPublicClient() {
  let env: ReturnType<typeof getClientEnv>;
  try {
    env = getClientEnv();
  } catch {
    return null;
  }
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

/**
 * `next build` sem Supabase acessível (CI usa uma URL fictícia): a página pré-renderiza
 * vazia em vez de derrubar o build; na Vercel o build alcança o banco normalmente.
 * Em execução (ISR) o erro continua subindo, e a Vercel mantém a versão anterior em cache.
 */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}
