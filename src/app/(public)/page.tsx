import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';

import { withCover } from '@/features/catalog/presenters';
import { getCatalog } from '@/features/catalog/queries';
import type { CourseView } from '@/features/catalog/components/types';

import { LandingView } from './_landing/LandingView';

const title = 'Scorpion Bits Learn — aprenda a criar jogos com quem faz jogos';
const description =
  'Cursos online de desenvolvimento de jogos do estúdio Scorpion Bits: aulas em vídeo, material de apoio e projetos práticos, do zero ao primeiro jogo publicado.';

// `openGraph`/`twitter` de uma página substituem os do layout (merge raso): repetimos a imagem.
const ogImage = {
  url: '/brand/og-cover.png',
  width: 1200,
  height: 630,
  alt: 'Scorpion Bits Learn — cursos de desenvolvimento de jogos',
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Scorpion Bits Learn',
    url: '/',
    title,
    description,
    images: [ogImage],
  },
  twitter: { card: 'summary_large_image', title, description, images: [ogImage.url] },
};

/** Página igual para todos: cache de 5 min (admin revalida ao salvar um curso). */
export const revalidate = 300;

/** Até 3 cursos publicados. Supabase indisponível/sem env = lista vazia (a seção some). */
async function featuredCourses(): Promise<CourseView[]> {
  try {
    const { courses } = await getCatalog();
    return courses.slice(0, 3).map(withCover);
  } catch (error) {
    unstable_rethrow(error);
    return [];
  }
}

export default async function HomePage() {
  return <LandingView courses={await featuredCourses()} />;
}
