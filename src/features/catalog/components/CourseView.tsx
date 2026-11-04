import Link from 'next/link';

import { ChamferCard, IsoCover } from '@/components/brand';
import { Badge, Button } from '@/components/ui';
import { whatsappUrl } from '@/config/company';

import {
  descriptionToBlocks,
  formatDuration,
  formatPrice,
  pluralLessons,
  resolveCta,
} from '../model';
import type { OutlineModule } from '../model';
import { LevelCubes } from './LevelCubes';
import styles from './CourseView.module.css';
import type { CourseView as Course } from './types';

export interface CourseViewProps {
  course: Course;
  outline: OutlineModule[];
  signedIn: boolean;
  hasAccess: boolean;
}

function Description({ markdown }: { markdown: string | null }) {
  const blocks = descriptionToBlocks(markdown);
  if (blocks.length === 0) return null;
  return (
    <section aria-labelledby="sobre" className={styles.section}>
      <h2 id="sobre" className={styles.h2}>
        Sobre o curso
      </h2>
      <div className={styles.prose}>
        {blocks.map((b, i) =>
          b.type === 'h' ? (
            <h3 key={i}>{b.text}</h3>
          ) : b.type === 'ul' ? (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{b.text}</p>
          ),
        )}
      </div>
    </section>
  );
}

/** Prévia exige conta: logado abre no player; visitante cria a conta e volta para a aula. */
function previewLessonHref(slug: string, lessonId: string, signedIn: boolean): string {
  const lessonPath = `/aprender/${slug}/${lessonId}`;
  return signedIn ? lessonPath : `/cadastro?next=${encodeURIComponent(lessonPath)}`;
}

function Syllabus({
  slug,
  outline,
  signedIn,
}: {
  slug: string;
  outline: OutlineModule[];
  signedIn: boolean;
}) {
  const previewHref = (lessonId: string) => previewLessonHref(slug, lessonId, signedIn);
  return (
    <section aria-labelledby="ementa" className={styles.section}>
      <h2 id="ementa" className={styles.h2}>
        Ementa
      </h2>
      {outline.length === 0 ? (
        <p className={styles.muted}>A ementa será publicada em breve.</p>
      ) : (
        <ol className={styles.modules}>
          {outline.map((mod, i) => {
            const total = mod.lessons.reduce((sum, l) => sum + l.durationSeconds, 0);
            const duration = formatDuration(total);
            return (
              <li key={mod.id}>
                <details className={styles.module} open={i === 0}>
                  <summary className={styles.summary}>
                    <span className={styles.index} aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className={styles.moduleText}>
                      <span className={styles.moduleTitle}>{mod.title}</span>
                      <span className={styles.moduleMeta}>
                        {pluralLessons(mod.lessons.length)}
                        {duration && ` · ${duration}`}
                      </span>
                    </span>
                    <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m4 6 4 4 4-4" />
                    </svg>
                  </summary>
                  <ul className={styles.lessons}>
                    {mod.lessons.map((lesson) => {
                      const lessonDuration = formatDuration(lesson.durationSeconds);
                      const content = (
                        <>
                          <span className={styles.lessonTitle}>{lesson.title}</span>
                          <span className={styles.lessonMeta}>
                            {lesson.isPreview && <Badge tone="cyan">Prévia</Badge>}
                            {lessonDuration && <span>{lessonDuration}</span>}
                          </span>
                        </>
                      );
                      return (
                        <li key={lesson.id}>
                          {lesson.isPreview ? (
                            <Link
                              href={previewHref(lesson.id)}
                              className={`${styles.lesson} ${styles.lessonLink}`}
                            >
                              {content}
                            </Link>
                          ) : (
                            <div className={styles.lesson}>{content}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Selos de confiança perto do botão de compra (fatos verificáveis: termos, AbacatePay, CDC). */
function TrustList() {
  return (
    <ul className={styles.trust}>
      <li>
        <ShieldIcon />
        Pagamento seguro pela AbacatePay
      </li>
      <li>
        <ShieldIcon />
        Garantia de 7 dias: não gostou, devolvemos seu dinheiro
      </li>
      <li>
        <ShieldIcon />
        Acesso liberado na hora, no celular ou no computador
      </li>
    </ul>
  );
}

function ShieldIcon() {
  return (
    <svg className={styles.trustIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 2.5 3.5v4c0 3.2 2.3 5.9 5.5 7 3.2-1.1 5.5-3.8 5.5-7v-4L8 1.5Z" />
      <path d="m5.5 8 1.8 1.8L10.8 6.3" />
    </svg>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Como recebo o acesso?',
    a: 'Assim que o pagamento é confirmado, o curso aparece em "Minha biblioteca" na sua conta. No PIX isso costuma levar poucos segundos.',
  },
  {
    q: 'Quais são as formas de pagamento?',
    a: 'PIX ou cartão de crédito, processados pela AbacatePay. A Scorpion Bits não vê nem guarda os dados do seu cartão.',
  },
  {
    q: 'Posso ver uma aula antes de comprar?',
    a: 'Sim. As aulas marcadas como "Prévia" na ementa são gratuitas: basta criar uma conta.',
  },
  {
    q: 'Consigo assistir pelo celular?',
    a: 'Sim. A plataforma funciona no navegador do celular, do tablet e do computador, sem instalar nada.',
  },
  {
    q: 'E se eu não gostar?',
    a: 'Você tem 7 dias após a compra para pedir o reembolso integral, direto em "Minha conta", sem precisar explicar o motivo.',
  },
];

function Faq({ title }: { title: string }) {
  return (
    <section aria-labelledby="faq" className={styles.section}>
      <h2 id="faq" className={styles.h2}>
        Perguntas frequentes
      </h2>
      <div className={styles.faq}>
        {FAQ.map((item) => (
          <details key={item.q} className={styles.faqItem}>
            <summary className={styles.faqQ}>
              {item.q}
              <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </summary>
            <p className={styles.faqA}>{item.a}</p>
          </details>
        ))}
      </div>
      <p className={styles.faqMore}>
        Ainda tem dúvida?{' '}
        <a
          href={whatsappUrl(`Olá! Tenho uma dúvida sobre o curso ${title}.`)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Fale com a gente no WhatsApp
          <span className={styles.sr}> (abre em nova aba)</span>
        </a>{' '}
        ou leia os <Link href="/termos">termos de uso</Link>.
      </p>
    </section>
  );
}

/** "Dúvidas? Fale no WhatsApp": abre a conversa já citando o curso. */
function WhatsAppHelp({ title, className }: { title: string; className?: string }) {
  return (
    <p className={className}>
      Dúvidas?{' '}
      <a
        href={whatsappUrl(`Olá! Tenho uma dúvida sobre o curso ${title}.`)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Fale no WhatsApp
        <span className={styles.sr}> (abre em nova aba)</span>
      </a>
    </p>
  );
}

export function CourseView({ course, outline, signedIn, hasAccess }: CourseViewProps) {
  const cta = resolveCta(course.slug, signedIn, hasAccess);
  const duration = formatDuration(course.durationSeconds);
  const price = formatPrice(course.priceCents);
  // Primeira aula de prévia: "Assistir aula grátis" (cadastro leva direto para ela).
  const firstPreview = outline.flatMap((m) => m.lessons).find((l) => l.isPreview);
  const freeHref =
    !hasAccess && firstPreview ? previewLessonHref(course.slug, firstPreview.id, signedIn) : null;

  return (
    <div className={styles.page}>
      <nav aria-label="Você está em" className={styles.crumbs}>
        <Link href="/cursos">Cursos</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{course.title}</span>
      </nav>

      <div className={styles.layout}>
        <header className={styles.hero}>
          <div className={styles.cover}>
            <IsoCover
              src={course.coverUrl}
              alt={`Capa do curso ${course.title}`}
              title={course.title}
              priority
              sizes="(max-width: 1024px) 100vw, 560px"
            />
          </div>
          <div className={styles.heroText}>
            {course.categoryName && <p className={styles.category}>{course.categoryName}</p>}
            <h1 className={styles.title}>{course.title}</h1>
            {course.subtitle && <p className={styles.subtitle}>{course.subtitle}</p>}
            <ul className={styles.facts}>
              <li>
                <LevelCubes level={course.level} />
              </li>
              <li>{pluralLessons(course.lessonCount)}</li>
              {duration && <li>{duration}</li>}
            </ul>
            {freeHref && (
              <Button href={freeHref} variant="secondary" size="lg" className={styles.freeMobile}>
                Assistir aula grátis
              </Button>
            )}
            {!hasAccess && <WhatsAppHelp title={course.title} className={styles.helpMobile} />}
          </div>
        </header>

        <aside className={styles.buy} aria-label="Compra">
          <ChamferCard as="div" className={styles.buyCard}>
            <p className={styles.price}>
              <span className={styles.priceLabel}>Preço</span>
              {price}
            </p>
            {hasAccess && <Badge tone="mint">Na sua biblioteca</Badge>}
            <div className={styles.buyActions}>
              <Button href={cta.href} size="lg" fullWidth>
                {cta.label}
              </Button>
              {freeHref && (
                <Button href={freeHref} variant="secondary" size="lg" fullWidth>
                  Assistir aula grátis
                </Button>
              )}
            </div>
            {(cta.kind === 'buy' || cta.kind === 'sign-up') && (
              <p className={styles.note}>
                Pagamento por PIX ou cartão. Acesso liberado após a confirmação.
              </p>
            )}
            {!hasAccess && <TrustList />}
            {!hasAccess && <WhatsAppHelp title={course.title} className={styles.help} />}
          </ChamferCard>
        </aside>

        <div className={styles.content}>
          <Description markdown={course.description} />
          <Syllabus slug={course.slug} outline={outline} signedIn={signedIn} />
          {!hasAccess && <Faq title={course.title} />}
        </div>
      </div>

      {/* < 720px: CTA fixo no rodapé (zona do polegar). */}
      <div className={styles.bar}>
        <p className={styles.barPrice}>
          <span className={styles.priceLabel}>{hasAccess ? 'Na sua biblioteca' : 'Preço'}</span>
          {hasAccess ? course.title : price}
        </p>
        <Button href={cta.href} size="lg">
          {cta.label}
        </Button>
      </div>
    </div>
  );
}
