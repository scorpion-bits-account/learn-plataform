import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/ui';

import { grotesk, inter } from './fonts';
import { LITE_MODE_SCRIPT } from './lite-mode-script';

import '@/styles/tokens.css';
import '@/styles/base.css';

/**
 * Base absoluta para URLs de metadata (OG image etc.). Lê a env pública
 * diretamente (e valida) em vez de `getClientEnv()` para que `next build`
 * funcione sem variáveis definidas.
 */
function resolveMetadataBase(): URL {
  const fallback = 'http://localhost:3000';
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || fallback);
  } catch {
    return new URL(fallback);
  }
}

const description = 'Plataforma de cursos da Scorpion Bits — aprenda desenvolvimento de jogos.';

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: 'Scorpion Bits Learn',
    template: '%s · Scorpion Bits Learn',
  },
  description,
  applicationName: 'Scorpion Bits Learn',
  icons: {
    icon: [
      { url: '/brand/favicon.png', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Scorpion Bits Learn',
    title: 'Scorpion Bits Learn',
    description,
    images: [
      {
        url: '/brand/og-cover.png',
        width: 1200,
        height: 630,
        alt: 'Scorpion Bits Learn — cursos de desenvolvimento de jogos',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scorpion Bits Learn',
    description,
    images: ['/brand/og-cover.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#05090f', // = --ink-950 (CSS vars não existem aqui)
  colorScheme: 'dark',
  viewportFit: 'cover', // habilita env(safe-area-inset-*) no iOS (ADR-019)
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: o script de modo leve adiciona data-lite ao
    // <html> antes da hidratação.
    <html lang="pt-BR" className={`${grotesk.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LITE_MODE_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
