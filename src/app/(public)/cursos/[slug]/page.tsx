import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CourseViewLive } from '@/features/catalog/components/CourseViewLive';
import { descriptionToBlocks } from '@/features/catalog/model';
import { withCover } from '@/features/catalog/presenters';
import { getCoursePage, getPublicCourse, getPublishedSlugs } from '@/features/catalog/queries';

type Params = Promise<{ slug: string }>;

/** Igual para todos: cache de 5 min; cursos publicados saem prontos do build. */
export const revalidate = 300;

export async function generateStaticParams() {
  return (await getPublishedSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const course = await getPublicCourse(slug);
  if (!course) return { title: 'Curso não encontrado', robots: { index: false } };

  const { coverUrl } = withCover(course);
  const description =
    course.subtitle ??
    descriptionToBlocks(course.description)
      .find((b) => b.type === 'p')
      ?.text.slice(0, 200) ??
    'Curso de game dev da Scorpion Bits.';

  return {
    title: course.title,
    description,
    alternates: { canonical: `/cursos/${course.slug}` },
    openGraph: {
      type: 'website',
      title: course.title,
      description,
      url: `/cursos/${course.slug}`,
      ...(coverUrl ? { images: [{ url: coverUrl, alt: `Capa do curso ${course.title}` }] } : {}),
    },
    twitter: {
      card: coverUrl ? 'summary_large_image' : 'summary',
      title: course.title,
      description,
      ...(coverUrl ? { images: [coverUrl] } : {}),
    },
  };
}

export default async function CoursePage({ params }: { params: Params }) {
  const { slug } = await params;
  const data = await getCoursePage(slug);
  if (!data) notFound();

  return <CourseViewLive course={withCover(data.course)} outline={data.outline} />;
}
