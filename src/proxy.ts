import type { NextRequest } from 'next/server';

import { resolveAuthRedirect } from '@/lib/auth/routes';
import { redirectWithSession, updateSession } from '@/lib/supabase/proxy';

/**
 * Proxy (Next 16; antigo middleware). Renova a sessão e redireciona:
 * anônimo em rota protegida -> /entrar?next=…; logado em /entrar|/cadastro -> /inicio.
 * NÃO consulta o banco nem o papel (ver docs/authentication.md).
 */
export async function proxy(request: NextRequest) {
  const session = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  const target = resolveAuthRedirect({
    pathname,
    search,
    isAuthenticated: session.isAuthenticated,
  });
  if (target) return redirectWithSession(request, session, target);

  return session.response;
}

/**
 * Só onde a sessão importa: rotas protegidas, telas de entrada e as páginas dinâmicas que
 * leem a sessão no servidor. Páginas públicas em cache (landing, /cursos, /cursos/[slug],
 * termos, privacidade) e estáticos ficam de fora: nenhum trabalho de auth por visita.
 * Manter em sincronia com `PROTECTED_PREFIXES`/`GUEST_ONLY_PATHS` (src/lib/auth/routes.ts).
 */
export const config = {
  matcher: [
    // Link de email que caiu na Site URL com ?code= (encaminhado ao /auth/callback).
    { source: '/', has: [{ type: 'query', key: 'code' }] },
    '/inicio/:path*',
    '/minha-biblioteca/:path*',
    '/aprender/:path*',
    '/conta/:path*',
    '/checkout/:path*',
    '/admin/:path*',
    '/entrar',
    '/cadastro',
    '/redefinir-senha',
    '/cursos/:slug/acesso',
    '/previa/:path*',
  ],
};
