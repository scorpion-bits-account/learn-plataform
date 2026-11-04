import type { Metadata } from 'next';

import { GoogleSignIn } from '@/features/auth/components/GoogleSignIn';
import { isGoogleSignInEnabled } from '@/features/auth/providers';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { SignInForm } from '@/features/auth/components/SignInForm';
import { sanitizeNextPath } from '@/lib/auth/redirect';

export const metadata: Metadata = { title: 'Entrar' };

type Search = Promise<{ next?: string | string[]; erro?: string | string[] }>;

export default async function EntrarPage({ searchParams }: { searchParams: Search }) {
  const { next, erro } = await searchParams;
  const safeNext = typeof next === 'string' ? sanitizeNextPath(next) : undefined;
  const notice =
    erro === 'link-invalido'
      ? 'Este link é inválido ou expirou. Entre com sua senha ou peça um novo link.'
      : erro === 'google'
        ? 'Não foi possível entrar com o Google agora. Tente de novo ou use seu email.'
        : undefined;

  return (
    <AuthCard title="Entrar" lead="Acesse seus cursos na Scorpion Bits Learn.">
      {isGoogleSignInEnabled() ? <GoogleSignIn next={safeNext} /> : null}
      <SignInForm next={safeNext} notice={notice} />
    </AuthCard>
  );
}
