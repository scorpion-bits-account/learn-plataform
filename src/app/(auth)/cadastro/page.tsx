import type { Metadata } from 'next';

import { GoogleSignIn } from '@/features/auth/components/GoogleSignIn';
import { isGoogleSignInEnabled } from '@/features/auth/providers';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { SignUpForm } from '@/features/auth/components/SignUpForm';
import { sanitizeNextPath } from '@/lib/auth/redirect';

export const metadata: Metadata = { title: 'Criar conta' };

type Search = Promise<{ next?: string | string[] }>;

export default async function CadastroPage({ searchParams }: { searchParams: Search }) {
  const { next } = await searchParams;
  const safeNext = typeof next === 'string' ? sanitizeNextPath(next, '') || undefined : undefined;
  const buying = safeNext?.startsWith('/checkout/') ?? false;
  const preview = safeNext?.startsWith('/aprender/') ?? false;

  return (
    <AuthCard
      title="Criar conta"
      lead={
        buying
          ? 'Crie sua conta para concluir a compra. Leva menos de um minuto.'
          : preview
            ? 'Crie sua conta grátis para assistir à prévia do curso.'
            : 'Comece a aprender a criar jogos.'
      }
    >
      {isGoogleSignInEnabled() ? <GoogleSignIn next={safeNext} /> : null}
      <SignUpForm next={safeNext} />
    </AuthCard>
  );
}
