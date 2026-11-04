import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ChamferCard } from '@/components/brand';
import { Button, TextLink } from '@/components/ui';
import { formatPrice } from '@/features/catalog/model';
import { getPublishedCourse } from '@/features/catalog/queries';
import { getCurrentUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Você ainda não comprou este curso',
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;

/**
 * Destino dos materiais bloqueados da prévia (e de aulas fechadas).
 * - Tem o curso -> abre o curso normalmente (`/aprender/[slug]`).
 * - Logado sem o curso -> vai direto para a compra.
 * - Visitante -> esta tela, com "Criar conta" (que volta para a compra) e "Entrar".
 * Só UX: quem decide o acesso continua sendo o banco (RLS, `has_course_access`).
 */
export default async function CourseAccessPage({ params }: { params: Params }) {
  const { slug } = await params;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();

  const checkout = `/checkout/${course.slug}`;
  const user = await getCurrentUser();
  if (user) {
    const supabase = await createClient();
    const { data: hasAccess } = await supabase.rpc('has_course_access', {
      p_course_id: course.id,
    });
    redirect(hasAccess === true ? `/aprender/${course.slug}` : checkout);
  }

  const next = encodeURIComponent(checkout);
  return (
    <div className={styles.page}>
      <ChamferCard as="section" className={styles.card} aria-labelledby="acesso-titulo">
        <p className={styles.kicker}>Conteúdo do curso</p>
        <h1 id="acesso-titulo" className={styles.title}>
          Você ainda não comprou este curso
        </h1>
        <p className={styles.lead}>
          Os arquivos e links de <strong>{course.title}</strong> ficam disponíveis para quem comprou
          o curso. Crie sua conta para comprar e ter acesso imediato a todas as aulas.
        </p>
        <p className={styles.price}>
          <span className={styles.priceLabel}>Preço</span>
          {formatPrice(course.priceCents)}
        </p>
        <div className={styles.actions}>
          <Button href={`/cadastro?next=${next}`} size="lg" fullWidth>
            Criar conta e comprar
          </Button>
          <Button href={`/entrar?next=${next}`} variant="secondary" size="lg" fullWidth>
            Já tenho conta
          </Button>
        </div>
        <p className={styles.note}>
          Pagamento por PIX ou cartão. Acesso liberado após a confirmação.
        </p>
        <p className={styles.back}>
          <TextLink href={`/cursos/${course.slug}`}>Voltar para o curso</TextLink>
        </p>
      </ChamferCard>
    </div>
  );
}
