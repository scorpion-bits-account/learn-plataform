import 'server-only';

/**
 * Login social ligado por env (Vercel): só mostre o botão depois de ativar o provedor
 * Google no Supabase, senão o clique cai em erro. `AUTH_GOOGLE_ENABLED=true` liga.
 */
export function isGoogleSignInEnabled(): boolean {
  return process.env.AUTH_GOOGLE_ENABLED === 'true';
}
