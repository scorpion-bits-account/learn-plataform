'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { ChamferCard, IsoCube } from '@/components/brand';
import { Badge, Button, Skeleton, useToast } from '@/components/ui';
import { formatPrice } from '@/features/catalog/model';

import { getOrderStatus } from '../actions';
import {
  countdownAnnouncement,
  formatCountdown,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
} from '../model';
import type { MyOrder, OrderStatusSnapshot } from '../model';
import styles from './Checkout.module.css';
import { useOrderPolling, useRemainingMs } from './useOrderPolling';

export interface OrderStatusViewProps {
  order: MyOrder;
  /** Falso na vitrine: não consulta o servidor. */
  poll?: boolean;
  /** Injetável para testes; padrão = Server Action `getOrderStatus`. */
  fetchStatus?: (orderId: string) => Promise<OrderStatusSnapshot | null>;
}

async function defaultFetchStatus(orderId: string): Promise<OrderStatusSnapshot | null> {
  const result = await getOrderStatus({ orderId });
  return result.ok ? result.data : null;
}

const STEPS = [
  'Abra o app do seu banco.',
  'Escolha pagar com PIX e a opção "Pix Copia e Cola" (ou leia o QR Code).',
  'Cole o código, confira o valor e confirme.',
] as const;

/**
 * `/checkout/pedido/[orderId]`: QR PIX, copia-e-cola, contagem e acompanhamento
 * do status. A tela não decide nada: o status muda pelo webhook verificado ou pela
 * reconsulta do servidor à AbacatePay em `getOrderStatus` (ambos via `fulfill_order()`).
 */
export function OrderStatusView({
  order,
  poll = true,
  fetchStatus = defaultFetchStatus,
}: OrderStatusViewProps) {
  const router = useRouter();
  const isCard = order.paymentMethod === 'card';
  // Vencido localmente: o polling para (PIX vencido não pode mais ser pago). No cartão,
  // `expires_at` é só a janela de reaproveitamento do checkout: sem contagem regressiva.
  const remaining = useRemainingMs(isCard ? null : order.expiresAt, order.status === 'pending');
  const { snapshot, checking, timedOut, checkNow } = useOrderPolling({
    initial: { status: order.status, expiresAt: order.expiresAt },
    fetchStatus: () => fetchStatus(order.id),
    enabled: poll && order.status === 'pending' && remaining !== 0,
    onFinal: () => router.refresh(),
  });

  const status = snapshot.status;
  const slug = order.course.slug;
  const retryHref = slug ? `/checkout/${slug}` : '/catalogo';
  const qrExpired = status === 'pending' && remaining === 0;

  const view: 'pending' | 'card' | 'generating' | 'expired' | 'paid' | 'failed' | 'refunded' =
    status === 'pending'
      ? isCard
        ? 'card'
        : qrExpired
          ? 'expired'
          : order.pixBrCode
            ? 'pending'
            : 'generating'
      : status === 'expired'
        ? 'expired'
        : status === 'paid'
          ? 'paid'
          : status === 'refunded'
            ? 'refunded'
            : 'failed';

  return (
    <div className={styles.order}>
      <ChamferCard as="section" aria-labelledby="pedido-titulo">
        <p className={styles.eyebrow}>Pedido</p>
        <h1 id="pedido-titulo" className={styles.formTitle}>
          {order.course.title}
        </h1>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Status</dt>
            <dd>
              <Badge tone={ORDER_STATUS_TONE[qrExpired ? 'expired' : status]}>
                {ORDER_STATUS_LABEL[qrExpired ? 'expired' : status]}
              </Badge>
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Valor</dt>
            <dd>{formatPrice(order.amountCents)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Forma de pagamento</dt>
            <dd>{PAYMENT_METHOD_LABEL[order.paymentMethod]}</dd>
          </div>
        </dl>

        {view === 'pending' ? (
          <PixPanel
            order={order}
            remaining={remaining}
            checking={checking}
            timedOut={timedOut}
            onCheck={checkNow}
          />
        ) : null}

        {view === 'card' ? (
          <div className={styles.stateBox}>
            <p className={styles.stateTitle}>Aguardando a confirmação do cartão</p>
            <p className={styles.policy} role="status" aria-live="polite">
              {timedOut
                ? 'Paramos de verificar automaticamente. Se já pagou, toque em "Verificar agora".'
                : 'Se você já pagou na página da AbacatePay, a confirmação costuma levar alguns segundos. Esta página atualiza sozinha.'}
            </p>
            {order.checkoutUrl ? (
              <Button href={order.checkoutUrl} fullWidth>
                Ir para o pagamento com cartão
              </Button>
            ) : null}
            <Button
              variant="secondary"
              fullWidth
              pending={checking}
              onClick={() => void checkNow()}
            >
              Verificar agora
            </Button>
            <p className={styles.fine}>
              Prefere PIX? <Link href={retryHref}>Escolha outra forma de pagamento</Link>.
            </p>
          </div>
        ) : null}

        {view === 'generating' ? (
          <div role="status" aria-live="polite" className={styles.stateBox}>
            <p className={styles.policy}>
              Estamos gerando seu PIX. Isso leva só alguns segundos; esta página atualiza sozinha.
            </p>
            <Skeleton variant="block" height="10rem" />
            <Button
              variant="secondary"
              fullWidth
              pending={checking}
              onClick={() => void checkNow()}
            >
              Verificar agora
            </Button>
          </div>
        ) : null}

        {view === 'paid' ? <PaidPanel slug={slug} /> : null}

        {view === 'expired' ? (
          <div role="status" className={styles.stateBox}>
            {isCard ? (
              <>
                <p className={styles.stateTitle}>Este pagamento não foi concluído</p>
                <p className={styles.policy}>
                  Não recebemos a confirmação do cartão para este pedido. Para comprar, inicie um
                  novo pagamento.
                </p>
                <Button href={retryHref} fullWidth>
                  Tentar de novo
                </Button>
              </>
            ) : (
              <>
                <p className={styles.stateTitle}>Este PIX expirou</p>
                <p className={styles.policy}>
                  O código não vale mais, então não pague por ele. Nenhum valor foi cobrado. Gere um
                  novo PIX para continuar.
                </p>
                <Button href={retryHref} fullWidth>
                  Gerar novo PIX
                </Button>
              </>
            )}
          </div>
        ) : null}

        {view === 'failed' ? (
          <div role="status" className={styles.stateBox}>
            <p className={styles.stateTitle}>
              {status === 'canceled' ? 'Pedido cancelado' : 'Não foi possível concluir o pagamento'}
            </p>
            <p className={styles.policy}>Nenhum valor foi cobrado. Você pode tentar de novo.</p>
            <Button href={retryHref} fullWidth>
              Tentar de novo
            </Button>
          </div>
        ) : null}

        {view === 'refunded' ? (
          <div role="status" className={styles.stateBox}>
            <p className={styles.stateTitle}>Pedido reembolsado</p>
            <p className={styles.policy}>
              O valor deste pedido foi devolvido e o acesso ao curso foi encerrado. O estorno pode
              levar alguns dias para aparecer no seu banco.
            </p>
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button href="/minha-biblioteca" variant="secondary" fullWidth>
            Minha biblioteca
          </Button>
        </div>
      </ChamferCard>
    </div>
  );
}

function PaidPanel({ slug }: { slug: string | null }) {
  return (
    <div role="status" className={styles.stateBox}>
      <div className={styles.cubes} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={styles.cube} style={{ animationDelay: `${i * 140}ms` }}>
            <IsoCube size={36} state="active" tone={i % 2 ? 'cyan' : 'mint'} />
          </span>
        ))}
      </div>
      <p className={styles.stateTitle}>Pagamento confirmado!</p>
      <p className={styles.policy}>Seu acesso ao curso está liberado. Bons estudos!</p>
      {slug ? (
        <Button href={`/aprender/${slug}`} fullWidth>
          Começar o curso
        </Button>
      ) : null}
    </div>
  );
}

interface PixPanelProps {
  order: MyOrder;
  remaining: number | null;
  checking: boolean;
  timedOut: boolean;
  onCheck: () => Promise<void>;
}

function PixPanel({ order, remaining, checking, timedOut, onCheck }: PixPanelProps) {
  const { toast } = useToast();
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const code = order.pixBrCode ?? '';

  // Anúncio por minuto: muda só quando o minuto restante muda.
  const announcement = remaining === null ? '' : countdownAnnouncement(remaining);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ tone: 'success', title: 'Código copiado', description: 'Cole no app do seu banco.' });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      codeRef.current?.focus();
      codeRef.current?.select();
      toast({
        tone: 'info',
        title: 'Copie manualmente',
        description: 'O código está selecionado: use o menu de copiar do aparelho.',
      });
    }
  }

  return (
    <div className={styles.pix}>
      <div className={styles.countdown}>
        <span className={styles.countdownLabel}>Expira em</span>
        <span className={styles.countdownValue} aria-hidden="true">
          {remaining === null ? '--:--' : formatCountdown(remaining)}
        </span>
        <span className={styles.srOnly} role="status" aria-live="polite">
          {announcement}
        </span>
      </div>

      <div className={styles.pixGrid}>
        <div className={styles.copyBox}>
          <label htmlFor="pix-code" className={styles.pixLabel}>
            Pix Copia e Cola
          </label>
          <textarea
            id="pix-code"
            ref={codeRef}
            className={styles.codeField}
            value={code}
            readOnly
            rows={6}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button fullWidth onClick={() => void copy()}>
            {copied ? 'Copiado!' : 'Copiar código'}
          </Button>
        </div>

        {order.pixQrSrc ? (
          <div className={styles.qrBox}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL do provedor */}
            <img
              src={order.pixQrSrc}
              alt={`QR Code PIX para pagar ${formatPrice(order.amountCents)} do curso ${order.course.title}`}
              className={styles.qr}
              width={220}
              height={220}
            />
            <p className={styles.fine}>Prefere ler o QR Code? Aponte a câmera do app do banco.</p>
          </div>
        ) : null}
      </div>

      <ol className={styles.steps}>
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <p className={styles.policy} role="status" aria-live="polite">
        {timedOut
          ? 'Paramos de verificar automaticamente. Se já pagou, toque em "Verificar agora".'
          : 'Aguardando o pagamento. Esta página atualiza sozinha quando o PIX for confirmado.'}
      </p>
      <Button variant="secondary" fullWidth pending={checking} onClick={() => void onCheck()}>
        Verificar agora
      </Button>
    </div>
  );
}
