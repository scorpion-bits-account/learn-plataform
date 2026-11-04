'use client';

import { useActionState, useRef } from 'react';

import { Button, Field, Input, TextLink } from '@/components/ui';

import { signUp } from '../actions';
import { IDLE_STATE, MIN_PASSWORD_LENGTH } from '../form-state';
import styles from './auth-form.module.css';
import { PasswordInput } from './PasswordInput';
import { useFocusOnError } from './useFocusOnError';

export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useFocusOnError(state, formRef, alertRef);

  if (state.status === 'success') {
    return (
      <div className={styles.form}>
        <p className={styles.notice} role="status">
          <strong>Confira seu email.</strong> {state.message}
        </p>
        <p className={styles.footer}>
          Não chegou? Veja a caixa de spam ou{' '}
          <TextLink href={next ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar'}>
            volte para entrar
          </TextLink>
          .
        </p>
      </div>
    );
  }

  const errors = state.status === 'error' ? state.fieldErrors : undefined;
  const values = state.status === 'error' ? state.values : undefined;

  return (
    <form ref={formRef} action={action} className={styles.form} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.status === 'error' ? (
        <div ref={alertRef} className={styles.alert} role="alert" tabIndex={-1}>
          {state.message}
        </div>
      ) : null}
      <Field label="Nome" required error={errors?.full_name?.[0]}>
        <Input
          name="full_name"
          autoComplete="name"
          enterKeyHint="next"
          defaultValue={values?.full_name}
          autoFocus
        />
      </Field>
      <Field label="Email" required error={errors?.email?.[0]}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          enterKeyHint="next"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={values?.email}
        />
      </Field>
      <Field
        label="Senha"
        required
        hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres.`}
        error={errors?.password?.[0]}
      >
        <PasswordInput name="password" autoComplete="new-password" enterKeyHint="next" />
      </Field>
      <Field label="Confirmar senha" required error={errors?.confirm_password?.[0]}>
        <PasswordInput name="confirm_password" autoComplete="new-password" enterKeyHint="go" />
      </Field>
      <Button type="submit" fullWidth size="lg" pending={pending}>
        {pending ? 'Criando conta…' : 'Criar conta'}
      </Button>
      <p className={styles.footer}>
        Já tem conta?{' '}
        <TextLink href={next ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar'}>
          Entrar
        </TextLink>
      </p>
    </form>
  );
}
