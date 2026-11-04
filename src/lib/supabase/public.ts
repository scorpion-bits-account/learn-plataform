import 'server-only';

import { createClient } from '@supabase/supabase-js';

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
