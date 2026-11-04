'use client';

import { useActionState, useRef } from 'react';

import { Button, Field, Input, TextLink } from '@/components/ui';

import { signIn } from '../actions';
import { IDLE_STATE } from '../form-state';
import styles from './auth-form.module.css';
import { PasswordInput } from './PasswordInput';
import { useFocusOnError } from './useFocusOnError';

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useFocusOnError(state, formRef, alertRef);

  const errors = state.status === 'error' ? state.fieldErrors : undefined;
  const values = state.status === 'error' ? state.values : undefined;

  return (
    <form ref={formRef} action={action} className={styles.form} noValidate>
      {notice && state.status !== 'error' ? (
        <p className={styles.alert} role="alert">
          {notice}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div ref={alertRef} className={styles.alert} role="alert" tabIndex={-1}>
          {state.message}
        </div>
      ) : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" required error={errors?.email?.[0]}>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          enterKeyHint="next"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={values?.email}
          autoFocus
        />
      </Field>
      <Field label="Senha" required error={errors?.password?.[0]}>
        <PasswordInput name="password" autoComplete="current-password" enterKeyHint="go" />
      </Field>
      <Button type="submit" fullWidth size="lg" pending={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
      <div className={styles.links}>
        <TextLink href="/recuperar-senha">Esqueci minha senha</TextLink>
        <span>
          Novo por aqui?{' '}
          <TextLink href={next ? `/cadastro?next=${encodeURIComponent(next)}` : '/cadastro'}>
            Criar conta
          </TextLink>
        </span>
      </div>
    </form>
  );
}
