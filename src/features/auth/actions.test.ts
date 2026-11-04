import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signInWithOAuth: vi.fn(),
};
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth })) }));
vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_SITE_URL: 'https://learn.test' }),
}));

const getCurrentRole = vi.fn();
const getCurrentUser = vi.fn();
vi.mock('@/lib/auth/dal', () => ({
  getCurrentRole: () => getCurrentRole(),
  getCurrentUser: () => getCurrentUser(),
  requireUser: vi.fn(),
}));

import { requestPasswordReset, resetPassword, signIn, signInWithGoogle, signUp } from './actions';
import { INVALID_CREDENTIALS, RECOVERY_SENT } from './messages';
import { IDLE_STATE } from './schemas';

function form(data: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error('não redirecionou');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('signIn', () => {
  it('usa a mesma mensagem para qualquer falha de credencial', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
    const a = await signIn(IDLE_STATE, form({ email: 'a@b.co', password: 'x' }));
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });
    const b = await signIn(IDLE_STATE, form({ email: 'z@b.co', password: 'y' }));
    expect(a).toMatchObject({ status: 'error', message: INVALID_CREDENTIALS });
    expect(b).toMatchObject({ status: 'error', message: INVALID_CREDENTIALS });
  });

  it('não devolve a senha no estado de erro', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });
    const r = await signIn(IDLE_STATE, form({ email: 'a@b.co', password: 'segredo' }));
    expect(JSON.stringify(r)).not.toContain('segredo');
  });

  it('admin vai para /admin', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    getCurrentRole.mockResolvedValue('admin');
    const url = await redirectTarget(
      signIn(IDLE_STATE, form({ email: 'a@b.co', password: 'x', next: '/conta' })),
    );
    expect(url).toBe('/admin');
  });

  it('aluno vai para next sanitizado; next malicioso cai em /inicio', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    getCurrentRole.mockResolvedValue('student');
    expect(
      await redirectTarget(
        signIn(IDLE_STATE, form({ email: 'a@b.co', password: 'x', next: '/conta' })),
      ),
    ).toBe('/conta');
    expect(
      await redirectTarget(
        signIn(IDLE_STATE, form({ email: 'a@b.co', password: 'x', next: '//evil.com' })),
      ),
    ).toBe('/inicio');
  });

  it('input inválido não chama o Supabase', async () => {
    const r = await signIn(IDLE_STATE, form({ email: 'ruim', password: '' }));
    expect(r.status).toBe('error');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('signUp', () => {
  const valid = {
    full_name: 'Ana',
    email: 'ana@exemplo.com',
    password: 'senha-forte-1',
    confirm_password: 'senha-forte-1',
  };

  it('envia só full_name em metadata (nunca role) e o redirect correto', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const r = await signUp(IDLE_STATE, form({ ...valid, role: 'admin', data: '{"role":"admin"}' }));
    expect(r.status).toBe('success');
    const arg = auth.signUp.mock.calls[0]![0];
    expect(arg.options.data).toEqual({ full_name: 'Ana' });
    expect(JSON.stringify(arg)).not.toMatch(/role/);
    expect(arg.options.emailRedirectTo).toBe('https://learn.test/auth/callback?next=%2Finicio');
  });

  it('volta para a compra: next interno vai no link do email e no redirect com sessão', async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    await signUp(IDLE_STATE, form({ ...valid, next: '/checkout/astrodash' }));
    expect(auth.signUp.mock.calls[0]![0].options.emailRedirectTo).toBe(
      'https://learn.test/auth/callback?next=%2Fcheckout%2Fastrodash',
    );

    auth.signUp.mockResolvedValueOnce({ data: { session: {} }, error: null });
    expect(
      await redirectTarget(signUp(IDLE_STATE, form({ ...valid, next: '/checkout/astrodash' }))),
    ).toBe('/checkout/astrodash');
  });

  it('next externo é ignorado (sem open redirect)', async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: {} }, error: null });
    expect(
      await redirectTarget(signUp(IDLE_STATE, form({ ...valid, next: 'https://evil.test' }))),
    ).toBe('/inicio');
  });

  it('sem sessão mostra "Confira seu email" (não finge login)', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const r = await signUp(IDLE_STATE, form(valid));
    expect(r).toMatchObject({ status: 'success' });
    expect(r.status === 'success' && r.message).toContain('ana@exemplo.com');
  });

  it('senhas diferentes não chamam o Supabase', async () => {
    const r = await signUp(IDLE_STATE, form({ ...valid, confirm_password: 'x' }));
    expect(r).toMatchObject({ status: 'error' });
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});

describe('requestPasswordReset', () => {
  it('responde igual com erro ou sucesso do Supabase (sem enumeração)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const ok = await requestPasswordReset(IDLE_STATE, form({ email: 'existe@b.co' }));
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: 'user_not_found' } });
    const missing = await requestPasswordReset(IDLE_STATE, form({ email: 'nao@b.co' }));
    auth.resetPasswordForEmail.mockRejectedValue(new Error('boom'));
    const thrown = await requestPasswordReset(IDLE_STATE, form({ email: 'x@b.co' }));
    for (const r of [ok, missing, thrown]) {
      expect(r).toEqual({ status: 'success', message: RECOVERY_SENT });
    }
  });

  it('usa o redirectTo do callback para /redefinir-senha', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await requestPasswordReset(IDLE_STATE, form({ email: 'a@b.co' }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', {
      redirectTo: 'https://learn.test/auth/callback?next=/redefinir-senha',
    });
  });
});

describe('resetPassword', () => {
  it('exige sessão', async () => {
    getCurrentUser.mockResolvedValue(null);
    const r = await resetPassword(
      IDLE_STATE,
      form({ password: 'abcdefgh', confirm_password: 'abcdefgh' }),
    );
    expect(r.status).toBe('error');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('com sessão, valida e atualiza a senha', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u', email: 'a@b.co' });
    auth.updateUser.mockResolvedValue({ error: null });
    const url = await redirectTarget(
      resetPassword(IDLE_STATE, form({ password: 'abcdefgh', confirm_password: 'abcdefgh' })),
    );
    expect(url).toBe('/inicio');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'abcdefgh' });
  });

  it('senha curta é rejeitada antes do Supabase', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u', email: 'a@b.co' });
    const r = await resetPassword(IDLE_STATE, form({ password: 'abc', confirm_password: 'abc' }));
    expect(r.status).toBe('error');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('signInWithGoogle', () => {
  it('manda para o Google com a volta pelo callback e o next sanitizado', async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.test/o' },
      error: null,
    });
    const url = await redirectTarget(signInWithGoogle(form({ next: '/checkout/astrodash' })));
    expect(url).toBe('https://accounts.google.test/o');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://learn.test/auth/callback?next=%2Fcheckout%2Fastrodash' },
    });
  });

  it('ignora next externo (sem open redirect)', async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.test/o' },
      error: null,
    });
    await redirectTarget(signInWithGoogle(form({ next: '//evil.dev' })));
    expect(auth.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo).toBe(
      'https://learn.test/auth/callback?next=%2Finicio',
    );
  });

  it('erro do provedor volta para /entrar com aviso, mantendo o next', async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'off' } });
    const url = await redirectTarget(signInWithGoogle(form({ next: '/checkout/astrodash' })));
    expect(url).toBe('/entrar?next=%2Fcheckout%2Fastrodash&erro=google');
  });
});
