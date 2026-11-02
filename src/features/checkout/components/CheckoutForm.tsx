'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { Button, Field, Input, TextLink } from '@/components/ui';
import { formatBrPhone, formatCpf } from '@/lib/payments/tax-id';

import { startCheckout } from '../actions';
import { CHECKOUT_IDLE } from '../model';
import type { CheckoutFormState } from '../model';
import type { PaymentMethod } from '../schemas';
import styles from './Checkout.module.css';

export interface CheckoutFormProps {
  courseSlug: string;
  /** Máximo de parcelas no cartão para o preço do curso (exibição; quem decide é o servidor). */
  cardInstallments?: number;
  /** Método inicialmente marcado (padrão PIX). */
  defaultMethod?: PaymentMethod;
  defaultTaxId?: string;
  defaultPhone?: string;
  /** Só para a vitrine `/dev/checkout` (mostrar estados de erro sem chamar a action). */
  initialState?: CheckoutFormState;
}

async function submit(_prev: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const result = await startCheckout(formData); // sucesso = redirect para /checkout/pedido/<id>
  if (!result.ok) {
    return { status: 'error', message: result.error, fieldErrors: result.fieldErrors };
  }
  return { status: 'owned', href: result.data.href };
}

/**
 * PIX (CPF + celular -> "Gerar PIX") ou cartão ("Pagar com cartão" -> checkout
 * seguro da AbacatePay). Máscara leve (só formata; quem valida é o servidor).
 * Preço e comprador nunca saem daqui: o form só envia slug, método, CPF e telefone.
 * Dados de cartão NUNCA são digitados aqui (ADR-022).
 */
export function CheckoutForm({
  courseSlug,
  cardInstallments = 1,
  defaultMethod = 'pix',
  defaultTaxId = '',
  defaultPhone = '',
  initialState = CHECKOUT_IDLE,
}: CheckoutFormProps) {
  const [state, action, pending] = useActionState(submit, initialState);
  const [taxId, setTaxId] = useState(() => formatCpf(defaultTaxId));
  const [phone, setPhone] = useState(() => formatBrPhone(defaultPhone));
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const isCard = method === 'card';
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Depois de um envio com erro, foco no primeiro campo inválido (ou no aviso geral).
  useEffect(() => {
    if (state === initialState || state.status === 'idle') return; // só depois de um envio
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (firstInvalid ?? alertRef.current)?.focus();
  }, [state, initialState]);

  if (state.status === 'owned') {
    return (
      <div className={styles.notice} role="status" ref={alertRef} tabIndex={-1}>
        <p>
          <strong>Você já possui este curso.</strong> Ele está na sua biblioteca.
        </p>
        <Button href={state.href} fullWidth>
          Ir para o curso
        </Button>
      </div>
    );
  }

  const errors = state.status === 'error' ? state.fieldErrors : undefined;
  const generalError =
    state.status === 'error' && !errors?.taxId && !errors?.phone ? state.message : null;

  return (
    <form ref={formRef} action={action} className={styles.form} noValidate>
      <input type="hidden" name="courseSlug" value={courseSlug} />

      {state.status === 'error' ? (
        <div ref={alertRef} className={styles.alert} role="alert" tabIndex={-1}>
          {generalError ?? 'Revise os campos destacados.'}
        </div>
      ) : null}

      <fieldset className={styles.methods}>
        <legend className={styles.methodsLegend}>Forma de pagamento</legend>
        <label className={styles.methodOption}>
          <input
            type="radio"
            name="paymentMethod"
            value="pix"
            checked={!isCard}
            onChange={() => setMethod('pix')}
          />
          <span className={styles.methodName}>PIX</span>
          <span className={styles.methodHint}>À vista, com aprovação na hora.</span>
        </label>
        <label className={styles.methodOption}>
          <input
            type="radio"
            name="paymentMethod"
            value="card"
            checked={isCard}
            onChange={() => setMethod('card')}
          />
          <span className={styles.methodName}>Cartão de crédito</span>
          <span className={styles.methodHint}>
            {cardInstallments > 1 ? `À vista ou em até ${cardInstallments}x. ` : ''}
            Você digita o cartão na página segura da AbacatePay.
          </span>
        </label>
      </fieldset>

      {isCard ? (
        <p className={styles.policy}>
          Ao continuar, você vai para a página de pagamento da AbacatePay. Não recebemos nem
          guardamos os dados do seu cartão. Depois do pagamento, você volta para cá.
        </p>
      ) : (
        <>
          <Field
            label="CPF"
            required
            hint="Usado só para emitir a cobrança PIX."
            error={errors?.taxId?.[0]}
          >
            <Input
              name="taxId"
              value={taxId}
              onChange={(e) => setTaxId(formatCpf(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="000.000.000-00"
              spellCheck={false}
            />
          </Field>

          <Field label="Celular" required hint="Com DDD." error={errors?.phone?.[0]}>
            <Input
              name="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatBrPhone(e.target.value))}
              inputMode="numeric"
              autoComplete="tel-national"
              enterKeyHint="go"
              placeholder="(11) 90000-0000"
            />
          </Field>
        </>
      )}

      <p className={styles.policy}>
        Ao comprar, você concorda com os <TextLink href="/termos">Termos de uso</TextLink>.
      </p>

      <Button type="submit" size="lg" fullWidth pending={pending}>
        {isCard
          ? pending
            ? 'Abrindo pagamento…'
            : 'Pagar com cartão'
          : pending
            ? 'Gerando PIX…'
            : 'Gerar PIX'}
      </Button>
      <p className={styles.fine}>
        O acesso é liberado automaticamente quando o pagamento for confirmado.
      </p>
    </form>
  );
}
