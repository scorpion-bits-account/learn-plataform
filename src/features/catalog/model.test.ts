import { describe, expect, it } from 'vitest';

import {
  deriveCategories,
  descriptionToBlocks,
  formatDuration,
  formatPrice,
  groupOutline,
  mapCatalogRow,
  resolveCta,
} from './model';
import { parseCatalogFilters } from './schemas';

const row = {
  id: 'c1',
  slug: 'godot',
  title: 'Godot',
  subtitle: 'Sub',
  description: 'd',
  level: 'beginner' as const,
  price_cents: 19700,
  cover_path: 'c1/cover.png',
  category_id: 'k1',
  category_slug: 'programacao',
  category_name: 'Programação',
  category_position: 1,
  module_count: 2,
  lesson_count: 5,
  total_duration_seconds: 3900,
  estimated_minutes: 10,
  published_at: '2026-01-01',
};

describe('mapCatalogRow', () => {
  it('maps snake_case to camelCase', () => {
    expect(mapCatalogRow(row)).toMatchObject({
      id: 'c1',
      priceCents: 19700,
      lessonCount: 5,
      durationSeconds: 3900,
      categorySlug: 'programacao',
    });
  });

  it('falls back to estimated_minutes and zero counts', () => {
    const c = mapCatalogRow({
      ...row,
      total_duration_seconds: 0,
      lesson_count: null,
      price_cents: null,
    });
    expect(c).toMatchObject({ durationSeconds: 600, lessonCount: 0, priceCents: 0 });
  });

  it('drops rows missing required fields', () => {
    expect(mapCatalogRow({ ...row, slug: null })).toBeNull();
    expect(mapCatalogRow({ ...row, level: null })).toBeNull();
  });
});

describe('groupOutline', () => {
  const base = { course_id: 'c1', lesson_summary: null, duration_seconds: 60, is_preview: false };
  it('groups by module and sorts by position', () => {
    const out = groupOutline([
      {
        ...base,
        module_id: 'm2',
        module_position: 2,
        module_title: 'B',
        lesson_id: 'l3',
        lesson_position: 1,
        lesson_title: 'C',
      },
      {
        ...base,
        module_id: 'm1',
        module_position: 1,
        module_title: 'A',
        lesson_id: 'l2',
        lesson_position: 2,
        lesson_title: 'Y',
        is_preview: true,
      },
      {
        ...base,
        module_id: 'm1',
        module_position: 1,
        module_title: 'A',
        lesson_id: 'l1',
        lesson_position: 1,
        lesson_title: 'X',
      },
      {
        ...base,
        module_id: 'm3',
        module_position: 3,
        module_title: 'Vazio',
        lesson_id: null,
        lesson_position: null,
        lesson_title: null,
      },
    ]);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(out[0]?.lessons.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(out[0]?.lessons[1]?.isPreview).toBe(true);
  });
});

describe('deriveCategories', () => {
  it('dedupes and orders by position', () => {
    const cats = deriveCategories([
      { ...row, category_slug: 'b', category_name: 'B', category_position: 2 },
      { ...row, category_slug: 'a', category_name: 'A', category_position: 1 },
      { ...row, category_slug: 'a', category_name: 'A', category_position: 1 },
      { ...row, category_slug: null, category_name: null },
    ]);
    expect(cats).toEqual([
      { slug: 'a', name: 'A' },
      { slug: 'b', name: 'B' },
    ]);
  });
});

describe('formatters', () => {
  it('formats BRL', () => {
    expect(formatPrice(19700)).toBe('R$ 197,00');
    expect(formatPrice(0)).toBe('Grátis');
  });
  it('formats duration', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(45 * 60)).toBe('45min');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3600 + 20 * 60)).toBe('1h 20min');
  });
});

describe('descriptionToBlocks', () => {
  it('renders markdown as plain blocks without HTML', () => {
    const blocks = descriptionToBlocks(
      '## Título\n\nTexto **forte** com [link](http://x.y) e <script>.\n\n- um\n- *dois*',
    );
    expect(blocks).toEqual([
      { type: 'h', text: 'Título' },
      { type: 'p', text: 'Texto forte com link e <script>.' },
      { type: 'ul', items: ['um', 'dois'] },
    ]);
  });
  it('handles empty input', () => {
    expect(descriptionToBlocks(null)).toEqual([]);
    expect(descriptionToBlocks('  \n\n ')).toEqual([]);
  });
});

describe('resolveCta', () => {
  it('anonymous -> sign up, then straight to checkout', () => {
    expect(resolveCta('godot', false, false)).toMatchObject({
      kind: 'sign-up',
      href: '/cadastro?next=%2Fcheckout%2Fgodot',
      label: 'Comprar',
    });
  });
  it('signed in without access -> checkout', () => {
    expect(resolveCta('godot', true, false)).toMatchObject({
      kind: 'buy',
      href: '/checkout/godot',
    });
  });
  it('with access -> continue', () => {
    expect(resolveCta('godot', true, true)).toMatchObject({
      kind: 'continue',
      href: '/aprender/godot',
    });
  });
});

describe('parseCatalogFilters', () => {
  it('accepts valid values and uses first of arrays', () => {
    expect(parseCatalogFilters({ categoria: ['arte', 'x'], nivel: 'advanced' })).toEqual({
      categoria: 'arte',
      nivel: 'advanced',
    });
  });
  it('ignores invalid values', () => {
    expect(parseCatalogFilters({ categoria: 'A B;--', nivel: 'expert' })).toEqual({
      categoria: undefined,
      nivel: undefined,
    });
  });
});
