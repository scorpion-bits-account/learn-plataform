import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../actions', () => ({ getOrderStatus: vi.fn() }));

import { ToastProvider } from '@/components/ui';

import type { MyOrder } from '../model';
import { OrderStatusView } from './OrderStatusView';

const base: MyOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'pending',
  amountCents: 19700,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  hasPix: true,
  pixBrCode: '000201BRCODE',
  pixQrSrc: 'data:image/png;base64,iVBORw0KG==',
  paymentMethod: 'pix',
  checkoutUrl: null,
  course: { slug: 'godot-do-zero', title: 'Godot do zero' },
};

const wrap = (order: MyOrder, fetchStatus = vi.fn().mockResolvedValue(null)) =>
  render(
    <ToastProvider>
      <OrderStatusView order={order} fetchStatus={fetchStatus} />
    </ToastProvider>,
  );

afterEach(() => vi.useRealTimers());

describe('OrderStatusView', () => {
  it('mostra QR com alt, copia-e-cola somente leitura e copia ao clicar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    wrap(base);
    expect(screen.getByRole('img', { name: /QR Code PIX/ })).toBeInTheDocument();
    const field = screen.getByLabelText('Pix Copia e Cola');
    expect(field).toHaveAttribute('readonly');
    await userEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    expect(writeText).toHaveBeenCalledWith('000201BRCODE');
    expect(await screen.findByRole('button', { name: 'Copiado!' })).toBeInTheDocument();
  });

  it('copia-e-cola vem antes do QR no DOM (celular)', () => {
    wrap(base);
    const field = screen.getByLabelText('Pix Copia e Cola');
    const qr = screen.getByRole('img', { name: /QR Code PIX/ });
    expect(field.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('vencido localmente: mensagem e "Gerar novo PIX"', () => {
    wrap({ ...base, expiresAt: '2026-01-01T00:00:00Z' });
    expect(screen.getByText('Este PIX expirou')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gerar novo PIX' })).toHaveAttribute(
      'href',
      '/checkout/godot-do-zero',
    );
    expect(screen.queryByRole('img', { name: /QR Code/ })).not.toBeInTheDocument();
  });

  it('paid: CTA para o curso', () => {
    wrap({ ...base, status: 'paid', pixBrCode: null, pixQrSrc: null });
    expect(screen.getByRole('link', { name: 'Começar o curso' })).toHaveAttribute(
      'href',
      '/aprender/godot-do-zero',
    );
  });

  it('failed: nenhum valor cobrado', () => {
    wrap({ ...base, status: 'failed', pixBrCode: null, pixQrSrc: null });
    expect(screen.getByText(/Nenhum valor foi cobrado/)).toBeInTheDocument();
  });

  it('polling detecta paid e faz router.refresh()', async () => {
    vi.useFakeTimers();
    const fetchStatus = vi.fn().mockResolvedValue({ status: 'paid', expiresAt: base.expiresAt });
    wrap(base, fetchStatus);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText('Pagamento confirmado!')).toBeInTheDocument();
  });

  describe('cartão (checkout hospedado)', () => {
    const card: MyOrder = {
      ...base,
      hasPix: false,
      pixBrCode: null,
      pixQrSrc: null,
      paymentMethod: 'card',
      checkoutUrl: 'https://app.abacatepay.com/pay/bill_abc',
      // Janela de reaproveitamento vencida não vira "PIX expirado" no cartão.
      expiresAt: '2026-01-01T00:00:00Z',
    };

    it('pending: sem QR nem contagem; link para o checkout e "Verificar agora"', () => {
      wrap(card);
      expect(screen.getByText('Aguardando a confirmação do cartão')).toBeInTheDocument();
      expect(screen.getByText('Cartão de crédito')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ir para o pagamento com cartão' })).toHaveAttribute(
        'href',
        'https://app.abacatepay.com/pay/bill_abc',
      );
      expect(screen.getByRole('button', { name: 'Verificar agora' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Pix Copia e Cola')).not.toBeInTheDocument();
      expect(screen.queryByText('Este PIX expirou')).not.toBeInTheDocument();
    });

    it('expired: texto de cartão, sem falar em PIX', () => {
      wrap({ ...card, status: 'expired', checkoutUrl: null });
      expect(screen.getByText('Este pagamento não foi concluído')).toBeInTheDocument();
      expect(screen.queryByText('Este PIX expirou')).not.toBeInTheDocument();
    });
  });
});
