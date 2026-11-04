'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getCurrentRole, getCurrentUser, requireUser } from '@/lib/auth/dal';
import { sanitizeNextPath } from '@/lib/auth/redirect';
import { getClientEnv } from '@/lib/env/client';
import { createClient } from '@/lib/supabase/server';

import { INVALID_CREDENTIALS, RECOVERY_SENT } from './messages';
import { recoverPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from './schemas';
import type { AuthFormState } from './schemas';

/**
 * Encerra a sessão (chamado por um <form action> — POST, nunca GET).
 */
export async function signOut(): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  await supabase.auth.signOut(); // limpa os cookies de sessão desta resposta
  redirect('/');
}

/*
 * Ações de autenticação para visitantes. São endpoints públicos: validam com zod,
 * nunca confiam em `next` sem sanitizar e nunca revelam se uma conta existe.
 * Não usam `userAction` porque o chamador é, por definição, anônimo.
 */

const INVALID_FORM = 'Revise os campos destacados.';
const GENERIC_ERROR = 'Algo deu errado. Tente novamente em instantes.';

function toObject(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: INVALID_FORM,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: { email: str(formData, 'email') },
    };
  }
  const { email, password, next } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Sempre a mesma mensagem: não distingue senha errada, conta inexistente ou email não confirmado.
    return { status: 'error', message: INVALID_CREDENTIALS, values: { email } };
  }

  const role = await getCurrentRole(); // sempre de user_roles; aqui só decide o destino (UX)
  redirect(role === 'admin' ? '/admin' : sanitizeNextPath(next));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(toObject(formData));
  const values = { full_name: str(formData, 'full_name'), email: str(formData, 'email') };
  if (!parsed.success) {
    return {
      status: 'error',
      message: INVALID_FORM,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
    };
  }
  const { full_name, email, password } = parsed.data;
  // Volta para onde a pessoa estava (ex.: a compra do curso). Sempre path interno.
  const next = sanitizeNextPath(str(formData, 'next'));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name }, // somente o nome; o papel é sempre `student` (trigger)
      emailRedirectTo: `${getClientEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    const weak = error.code === 'weak_password';
    return {
      status: 'error',
      message: weak
        ? 'Escolha uma senha mais forte.'
        : 'Não foi possível criar a conta agora. Tente novamente em instantes.',
      fieldErrors: weak ? { password: ['Escolha uma senha mais forte.'] } : undefined,
      values,
    };
  }

  // Confirmação de email desligada: já há sessão.
  if (data.session) redirect(next);

  // Com confirmação ligada, email já cadastrado também cai aqui (Supabase não revela).
  return {
    status: 'success',
    message: `Enviamos um link de confirmação para ${email}. Abra o email para ativar sua conta.`,
  };
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = recoverPasswordSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: INVALID_FORM,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: { email: str(formData, 'email') },
    };
  }

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${getClientEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/redefinir-senha`,
    });
  } catch {
    // Engolido de propósito: qualquer diferença de resposta permitiria enumerar contas.
  }
  return { status: 'success', message: RECOVERY_SENT };
}

export async function resetPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  // Exige a sessão criada pelo link do email (/auth/callback).
  if (!(await getCurrentUser())) {
    return {
      status: 'error',
      message: 'Este link expirou ou já foi usado. Peça um novo link de recuperação.',
    };
  }

  const parsed = resetPasswordSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: INVALID_FORM,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const weak = error.code === 'weak_password' || error.code === 'same_password';
    return {
      status: 'error',
      message: weak ? 'Escolha uma senha diferente da atual e mais forte.' : GENERIC_ERROR,
      fieldErrors: weak ? { password: ['Escolha outra senha.'] } : undefined,
    };
  }

  redirect('/inicio');
}
