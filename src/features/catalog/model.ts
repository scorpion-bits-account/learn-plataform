import type { Database } from '@/types/database';

/** Tipos e funções puras do catálogo (sem I/O; testáveis sem mocks). */

export type CourseLevel = Database['public']['Enums']['course_level'];

export const LEVELS: readonly CourseLevel[] = ['beginner', 'intermediate', 'advanced'];

export const LEVEL_LABEL: Record<CourseLevel, string> = {
  beginner: 'Iniciante',
  intermediate: 'Intermediário',
  advanced: 'Avançado',
};

/** Nível em cubos (1–3). */
export const LEVEL_CUBES: Record<CourseLevel, 1 | 2 | 3> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

export type CatalogCourse = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: CourseLevel;
  priceCents: number;
  coverPath: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
};

export type CategoryOption = { slug: string; name: string };

export type OutlineLesson = {
  id: string;
  title: string;
  summary: string | null;
  durationSeconds: number;
  isPreview: boolean;
};

export type OutlineModule = {
  id: string;
  title: string;
  lessons: OutlineLesson[];
};

type CatalogRow = Database['public']['Views']['course_catalog']['Row'];
type OutlineRow = Database['public']['Views']['course_outline']['Row'];

/** Linha da view -> curso. Linhas sem id/slug/título/nível (views nulláveis) são descartadas. */
export function mapCatalogRow(row: CatalogRow): CatalogCourse | null {
  if (!row.id || !row.slug || !row.title || !row.level) return null;
  const seconds = row.total_duration_seconds ?? 0;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    level: row.level,
    priceCents: row.price_cents ?? 0,
    coverPath: row.cover_path,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    moduleCount: row.module_count ?? 0,
    lessonCount: row.lesson_count ?? 0,
    durationSeconds: seconds > 0 ? seconds : (row.estimated_minutes ?? 0) * 60,
  };
}

/** Linhas planas (uma por aula) -> módulos ordenados com suas aulas. */
export function groupOutline(rows: OutlineRow[]): OutlineModule[] {
  const sorted = rows
    .filter((r) => r.module_id && r.lesson_id)
    .sort(
      (a, b) =>
        (a.module_position ?? 0) - (b.module_position ?? 0) ||
        (a.lesson_position ?? 0) - (b.lesson_position ?? 0),
    );
  const modules = new Map<string, OutlineModule>();
  for (const r of sorted) {
    const moduleId = r.module_id as string;
    let mod = modules.get(moduleId);
    if (!mod) {
      mod = { id: moduleId, title: r.module_title ?? 'Módulo', lessons: [] };
      modules.set(moduleId, mod);
    }
    mod.lessons.push({
      id: r.lesson_id as string,
      title: r.lesson_title ?? 'Aula',
      summary: r.lesson_summary,
      durationSeconds: r.duration_seconds ?? 0,
      isPreview: r.is_preview === true,
    });
  }
  return [...modules.values()];
}

/** Categorias distintas, na ordem do catálogo. */
export function deriveCategories(rows: CatalogRow[]): CategoryOption[] {
  const seen = new Map<string, { name: string; position: number }>();
  for (const r of rows) {
    if (r.category_slug && r.category_name && !seen.has(r.category_slug)) {
      seen.set(r.category_slug, { name: r.category_name, position: r.category_position ?? 0 });
    }
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].position - b[1].position || a[1].name.localeCompare(b[1].name, 'pt-BR'))
    .map(([slug, v]) => ({ slug, name: v.name }));
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Preço em centavos -> "R$ 197,00"; 0 -> "Grátis". */
export function formatPrice(cents: number): string {
  return cents <= 0 ? 'Grátis' : brl.format(cents / 100).replace(/ /g, ' ');
}

/** Segundos -> "1h 20min", "45min", "30s"; 0 -> "". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function pluralLessons(n: number): string {
  return `${n} ${n === 1 ? 'aula' : 'aulas'}`;
}

export type DescriptionBlock =
  { type: 'p'; text: string } | { type: 'h'; text: string } | { type: 'ul'; items: string[] };

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

/**
 * Markdown -> blocos de texto simples (parágrafos, títulos, listas), sem HTML:
 * o React escapa tudo, então não há superfície de XSS e não precisamos de lib.
 */
export function descriptionToBlocks(markdown: string | null | undefined): DescriptionBlock[] {
  if (!markdown) return [];
  const blocks: DescriptionBlock[] = [];
  for (const chunk of markdown.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.every((l) => /^[-*+]\s+/.test(l))) {
      blocks.push({ type: 'ul', items: lines.map((l) => stripInline(l.replace(/^[-*+]\s+/, ''))) });
      continue;
    }
    const first = lines[0] ?? '';
    if (/^#{1,6}\s+/.test(first)) {
      blocks.push({ type: 'h', text: stripInline(first.replace(/^#{1,6}\s+/, '')) });
      lines.shift();
      if (lines.length === 0) continue;
    }
    const text = stripInline(lines.join(' '));
    if (text) blocks.push({ type: 'p', text });
  }
  return blocks;
}

export type CourseCta =
  | { kind: 'sign-up'; href: string; label: string }
  | { kind: 'buy'; href: string; label: string }
  | { kind: 'continue'; href: string; label: string };

/** CTA contextual da página do curso. Só navegação: a autorização real é da RLS. */
export function resolveCta(slug: string, signedIn: boolean, hasAccess: boolean): CourseCta {
  // Visitante: "Comprar" leva ao cadastro (quem já tem conta tem o link "Entrar" lá),
  // e depois direto para a compra.
  if (!signedIn) {
    return {
      kind: 'sign-up',
      href: `/cadastro?next=${encodeURIComponent(`/checkout/${slug}`)}`,
      label: 'Comprar',
    };
  }
  if (hasAccess) {
    return { kind: 'continue', href: `/aprender/${slug}`, label: 'Continuar curso' };
  }
  return { kind: 'buy', href: `/checkout/${slug}`, label: 'Comprar' };
}
