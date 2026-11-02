import Link from 'next/link';

import { ChamferCard, IsoCover } from '@/components/brand';
import { Badge, Button } from '@/components/ui';

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

function Syllabus({ slug, outline }: { slug: string; outline: OutlineModule[] }) {
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
                              href={`/aprender/${slug}/${lesson.id}`}
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

export function CourseView({ course, outline, signedIn, hasAccess }: CourseViewProps) {
  const cta = resolveCta(course.slug, signedIn, hasAccess);
  const duration = formatDuration(course.durationSeconds);
  const price = formatPrice(course.priceCents);

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
          </div>
        </header>

        <aside className={styles.buy} aria-label="Compra">
          <ChamferCard as="div" className={styles.buyCard}>
            <p className={styles.price}>
              <span className={styles.priceLabel}>Preço</span>
              {price}
            </p>
            {hasAccess && <Badge tone="mint">Na sua biblioteca</Badge>}
            <Button href={cta.href} size="lg" fullWidth>
              {cta.label}
            </Button>
            {cta.kind === 'buy' && (
              <p className={styles.note}>
                Pagamento por PIX ou cartão. Acesso liberado após a confirmação.
              </p>
            )}
          </ChamferCard>
        </aside>

        <div className={styles.content}>
          <Description markdown={course.description} />
          <Syllabus slug={course.slug} outline={outline} />
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
