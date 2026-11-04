import { describe, expect, it } from 'vitest';

import type { OutlineModule } from '@/features/catalog/model';

import {
  buildCourseMaterials,
  buildOutlineView,
  buildVideoEmbed,
  canOpenLesson,
  displayHost,
  flattenOutline,
  formatFileSize,
  lockForPreview,
  mapMaterialRow,
  resolveNeighbors,
  resolveResumeLessonId,
  safeExternalUrl,
  shortcutAction,
  tokenizeInline,
} from './model';
import type { CourseMaterialRow, MaterialRow, PlayerMaterial, ShortcutEventLike } from './model';

const lesson = (id: string, isPreview = false) => ({
  id,
  title: `Aula ${id}`,
  summary: null,
  durationSeconds: 600,
  isPreview,
});

const MODULES: OutlineModule[] = [
  { id: 'm1', title: 'Módulo 1', lessons: [lesson('a', true), lesson('b'), lesson('c', true)] },
  { id: 'm2', title: 'Módulo 2', lessons: [lesson('d'), lesson('e')] },
];
const LESSONS = flattenOutline(MODULES);
const OWNER = { hasAccess: true, coursePublished: true };
const VISITOR = { hasAccess: false, coursePublished: true };

describe('flattenOutline', () => {
  it('numera aulas no curso e no módulo, na ordem', () => {
    expect(LESSONS.map((l) => [l.id, l.number, l.moduleNumber, l.numberInModule])).toEqual([
      ['a', 1, 1, 1],
      ['b', 2, 1, 2],
      ['c', 3, 1, 3],
      ['d', 4, 2, 1],
      ['e', 5, 2, 2],
    ]);
    expect(LESSONS[3]?.moduleTitle).toBe('Módulo 2');
  });
});

describe('canOpenLesson', () => {
  it('acesso ao curso abre qualquer aula', () => {
    expect(canOpenLesson({ hasAccess: true, isPreview: false, coursePublished: false })).toBe(true);
  });
  it('prévia abre só em curso publicado', () => {
    expect(canOpenLesson({ hasAccess: false, isPreview: true, coursePublished: true })).toBe(true);
    expect(canOpenLesson({ hasAccess: false, isPreview: true, coursePublished: false })).toBe(
      false,
    );
  });
  it('sem acesso e fora da prévia: bloqueada', () => {
    expect(canOpenLesson({ hasAccess: false, isPreview: false, coursePublished: true })).toBe(
      false,
    );
  });
});

describe('resolveResumeLessonId', () => {
  const row = (lessonId: string, updatedAt: string, completedAt: string | null = null) => ({
    lessonId,
    updatedAt,
    completedAt,
  });

  it('usa a aula com updated_at mais recente (mesmo concluída)', () => {
    const progress = [
      row('a', '2026-10-01T10:00:00Z', '2026-10-01T10:30:00Z'),
      row('d', '2026-10-03T10:00:00Z'),
      row('b', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z'),
    ];
    expect(resolveResumeLessonId(LESSONS, progress, OWNER)).toBe('d');
  });

  it('sem progresso: primeira aula', () => {
    expect(resolveResumeLessonId(LESSONS, [], OWNER)).toBe('a');
  });

  it('progresso de aula que não existe mais é ignorado', () => {
    expect(resolveResumeLessonId(LESSONS, [row('zzz', '2026-10-03T10:00:00Z')], OWNER)).toBe('a');
  });

  it('só conta aulas que o usuário pode abrir (acesso revogado volta para as prévias)', () => {
    const progress = [row('d', '2026-10-03T10:00:00Z'), row('c', '2026-10-01T10:00:00Z')];
    expect(resolveResumeLessonId(LESSONS, progress, VISITOR)).toBe('c');
  });

  it('sem acesso e sem prévias: null', () => {
    const paid = flattenOutline([{ id: 'm', title: 'M', lessons: [lesson('x'), lesson('y')] }]);
    expect(resolveResumeLessonId(paid, [], VISITOR)).toBeNull();
  });

  it('curso sem aulas: null', () => {
    expect(resolveResumeLessonId([], [], OWNER)).toBeNull();
  });

  it('rascunho/arquivado sem acesso não abre prévias', () => {
    expect(resolveResumeLessonId(LESSONS, [], { hasAccess: false, coursePublished: false })).toBe(
      null,
    );
  });

  it('com linhas de progresso só concluídas e nenhuma recente, ainda escolhe a mais recente', () => {
    const progress = [
      row('a', '2026-10-01T00:00:00Z', '2026-10-01T00:10:00Z'),
      row('b', '2026-10-02T00:00:00Z', '2026-10-02T00:10:00Z'),
    ];
    expect(resolveResumeLessonId(LESSONS, progress, OWNER)).toBe('b');
  });
});

describe('resolveNeighbors', () => {
  it('quem tem acesso navega por todas as aulas', () => {
    const n = resolveNeighbors(LESSONS, 'b', OWNER);
    expect([n.prev?.id, n.next?.id, n.current?.id, n.total]).toEqual(['a', 'c', 'b', 5]);
  });

  it('primeira aula não tem anterior; última não tem próxima', () => {
    expect(resolveNeighbors(LESSONS, 'a', OWNER).prev).toBeNull();
    expect(resolveNeighbors(LESSONS, 'e', OWNER).next).toBeNull();
    expect(resolveNeighbors(LESSONS, 'e', OWNER).prev?.id).toBe('d');
  });

  it('sem compra pula as bloqueadas (a -> c) e termina na última prévia', () => {
    expect(resolveNeighbors(LESSONS, 'a', VISITOR).next?.id).toBe('c');
    expect(resolveNeighbors(LESSONS, 'c', VISITOR).prev?.id).toBe('a');
    expect(resolveNeighbors(LESSONS, 'c', VISITOR).next).toBeNull();
  });

  it('aula atual bloqueada ainda tem vizinhas acessíveis', () => {
    const n = resolveNeighbors(LESSONS, 'b', VISITOR);
    expect([n.prev?.id, n.next?.id]).toEqual(['a', 'c']);
  });

  it('id fora do curso: sem atual nem vizinhas', () => {
    expect(resolveNeighbors(LESSONS, 'nope', OWNER)).toMatchObject({
      current: null,
      prev: null,
      next: null,
    });
  });
});

describe('buildOutlineView', () => {
  const view = (access: { hasAccess: boolean; coursePublished: boolean }) =>
    buildOutlineView(MODULES, {
      currentId: 'b',
      access,
      completedIds: new Set(['a', 'd']),
      hrefFor: (id) => `/aprender/x/${id}`,
    });

  it('marca atual, concluída e disponível para quem tem acesso', () => {
    const states = view(OWNER).flatMap((m) => m.lessons.map((l) => [l.id, l.state]));
    expect(states).toEqual([
      ['a', 'completed'],
      ['b', 'current'],
      ['c', 'available'],
      ['d', 'completed'],
      ['e', 'available'],
    ]);
  });

  it('sem compra: não-prévias ficam bloqueadas e sem href; a atual continua atual', () => {
    const lessons = view(VISITOR).flatMap((m) => m.lessons);
    expect(lessons.find((l) => l.id === 'd')).toMatchObject({ state: 'locked', href: null });
    expect(lessons.find((l) => l.id === 'c')).toMatchObject({
      state: 'available',
      href: '/aprender/x/c',
    });
    expect(lessons.find((l) => l.id === 'b')?.state).toBe('current');
    expect(lessons[0]?.durationLabel).toBe('10min');
  });
});

describe('buildVideoEmbed', () => {
  it('YouTube: iframe youtube-nocookie e miniatura', () => {
    const embed = buildVideoEmbed('youtube', 'dQw4w9WgXcQ');
    expect(embed?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1',
    );
    expect(embed?.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(embed?.providerLabel).toBe('YouTube');
  });

  it('Vimeo: player.vimeo.com, com e sem hash de vídeo não listado', () => {
    expect(buildVideoEmbed('vimeo', '76979871')?.src).toBe(
      'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1',
    );
    expect(buildVideoEmbed('vimeo', '76979871/abc123def4')?.src).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123def4&autoplay=1&dnt=1',
    );
    expect(buildVideoEmbed('vimeo', '76979871')?.thumbnailUrl).toBeNull();
  });

  it('recusa ids fora do formato (nunca monta URL com dado não validado)', () => {
    expect(buildVideoEmbed('youtube', 'x"onload="alert(1)')).toBeNull();
    expect(buildVideoEmbed('youtube', 'curto')).toBeNull();
    expect(buildVideoEmbed('vimeo', '123/../../evil')).toBeNull();
    expect(buildVideoEmbed('vimeo', 'abc')).toBeNull();
  });

  it('provedor sem embed ou dados ausentes: null', () => {
    expect(buildVideoEmbed('bunny', 'abc')).toBeNull();
    expect(buildVideoEmbed(null, 'dQw4w9WgXcQ')).toBeNull();
    expect(buildVideoEmbed('youtube', null)).toBeNull();
  });
});

describe('safeExternalUrl / displayHost', () => {
  it('aceita http(s) e recusa outros esquemas e credenciais', () => {
    expect(safeExternalUrl('https://docs.godotengine.org/a?b=1')).toBe(
      'https://docs.godotengine.org/a?b=1',
    );
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>')).toBeNull();
    expect(safeExternalUrl('https://user:pass@example.com')).toBeNull();
    expect(safeExternalUrl('não é url')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
  it('host sem www', () => {
    expect(displayHost('https://www.example.com/x')).toBe('example.com');
  });
});

describe('formatFileSize', () => {
  it.each([
    [null, ''],
    [-1, ''],
    [0, '0 B'],
    [999, '999 B'],
    [1024, '1 KB'],
    [1536, '1,5 KB'],
    [3_407_872, '3,3 MB'],
    [209_715_200, '200 MB'],
    [5 * 1024 ** 3, '5 GB'],
  ])('%s -> %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('mapMaterialRow', () => {
  const base: MaterialRow = {
    id: 'id',
    type: 'text',
    title: ' Título ',
    body: null,
    external_url: null,
    video_provider: null,
    video_id: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    storage_path: null,
  };

  it('mapeia cada tipo e nunca expõe storage_path', () => {
    expect(mapMaterialRow({ ...base, type: 'text', body: '# oi' })).toEqual({
      id: 'id',
      type: 'text',
      title: 'Título',
      body: '# oi',
    });
    const file = mapMaterialRow({
      ...base,
      type: 'file',
      storage_path: 'c/l/11111111-1111-4111-8111-111111111111-guia.zip',
      file_name: null,
      file_size: 10,
    });
    expect(file).toMatchObject({ type: 'file', fileName: 'guia.zip', fileSize: 10 });
    expect(JSON.stringify(file)).not.toContain('storage_path');
    expect(JSON.stringify(file)).not.toContain('11111111-1111');
  });

  it('descarta linhas incompletas ou com link perigoso', () => {
    expect(mapMaterialRow({ ...base, type: 'video' })).toBeNull();
    expect(mapMaterialRow({ ...base, type: 'text', body: '   ' })).toBeNull();
    expect(mapMaterialRow({ ...base, type: 'file' })).toBeNull();
    expect(
      mapMaterialRow({ ...base, type: 'link', external_url: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(
      mapMaterialRow({ ...base, type: 'link', title: null, external_url: 'https://a.dev' }),
    ).toMatchObject({ type: 'link', title: null, url: 'https://a.dev/' });
  });
});

describe('buildCourseMaterials', () => {
  const lessons = [{ id: 'a1' }, { id: 'a2' }, { id: 'b1' }];
  const row = (id: string, lessonId: string, position: number, over: Partial<MaterialRow> = {}) =>
    ({
      id,
      lesson_id: lessonId,
      position,
      type: 'link',
      title: id,
      body: null,
      external_url: 'https://exemplo.com',
      video_provider: null,
      video_id: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      storage_path: null,
      ...over,
    }) as CourseMaterialRow;

  it('ordena por aula na ementa (módulo, depois aula) e por posição do material', () => {
    const result = buildCourseMaterials(
      [row('m-b1', 'b1', 0), row('m-a2-1', 'a2', 1), row('m-a2-0', 'a2', 0), row('m-a1', 'a1', 5)],
      lessons,
      'zzz',
    );
    expect(result.map((m) => m.id)).toEqual(['m-a1', 'm-a2-0', 'm-a2-1', 'm-b1']);
  });

  it('não repete os materiais da aula aberta', () => {
    const result = buildCourseMaterials(
      [row('own', 'a2', 0), row('other', 'a1', 0)],
      lessons,
      'a2',
    );
    expect(result.map((m) => m.id)).toEqual(['other']);
  });

  it('descarta linhas incompletas; aula fora da ementa vai para o fim; vazio -> []', () => {
    const result = buildCourseMaterials(
      [
        row('orphan', 'gone', 0),
        row('bad-url', 'a1', 0, { external_url: 'javascript:alert(1)' }),
        row('ok', 'b1', 0),
      ],
      lessons,
      'a2',
    );
    expect(result.map((m) => m.id)).toEqual(['ok', 'orphan']);
    expect(buildCourseMaterials([], lessons, 'a1')).toEqual([]);
  });
});

describe('tokenizeInline', () => {
  it('reconhece código, negrito, itálico e link http(s)', () => {
    expect(tokenizeInline('Use `Node2D` e **muito** *bem* [docs](https://a.dev).')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'Node2D' },
      { type: 'text', text: ' e ' },
      { type: 'strong', text: 'muito' },
      { type: 'text', text: ' ' },
      { type: 'em', text: 'bem' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'docs', href: 'https://a.dev/' },
      { type: 'text', text: '.' },
    ]);
  });

  it('link com esquema perigoso vira texto puro', () => {
    expect(tokenizeInline('[clique](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[clique](javascript:alert(1)' },
      { type: 'text', text: ')' },
    ]);
  });

  it('HTML cru passa como texto (o React escapa)', () => {
    expect(tokenizeInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('shortcutAction', () => {
  const key = (k: string, extra: Partial<ShortcutEventLike> = {}): ShortcutEventLike => ({
    key: k,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });

  it('[ e ] navegam', () => {
    expect(shortcutAction(key('['))).toBe('prev');
    expect(shortcutAction(key(']'))).toBe('next');
  });

  it('Alt+Shift+setas navegam; setas sozinhas ou só com Alt (voltar do navegador) não', () => {
    expect(shortcutAction(key('ArrowLeft', { altKey: true, shiftKey: true }))).toBe('prev');
    expect(shortcutAction(key('ArrowRight', { altKey: true, shiftKey: true }))).toBe('next');
    expect(shortcutAction(key('ArrowLeft'))).toBeNull();
    expect(shortcutAction(key('ArrowLeft', { altKey: true }))).toBeNull();
  });

  it('ignora Ctrl/Cmd, repetição, evento já tratado e campos de formulário', () => {
    expect(shortcutAction(key('[', { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key(']', { metaKey: true }))).toBeNull();
    expect(shortcutAction(key(']', { repeat: true }))).toBeNull();
    expect(shortcutAction(key(']', { defaultPrevented: true }))).toBeNull();
    for (const tagName of ['INPUT', 'textarea', 'SELECT']) {
      expect(
        shortcutAction(key('[', { target: { tagName } as unknown as EventTarget })),
      ).toBeNull();
    }
    expect(
      shortcutAction(key('[', { target: { tagName: 'DIV', isContentEditable: true } as never })),
    ).toBeNull();
    expect(shortcutAction(key('[', { target: { tagName: 'BUTTON' } as never }))).toBe('prev');
  });

  it('outras teclas não fazem nada', () => {
    expect(shortcutAction(key('a'))).toBeNull();
    expect(shortcutAction(key('{', { shiftKey: true }))).toBeNull();
  });
});

describe('lockForPreview', () => {
  const materials: PlayerMaterial[] = [
    { id: 'v', type: 'video', title: 'Aula', provider: 'youtube', videoId: 'abc' },
    { id: 't', type: 'text', title: null, body: 'oi' },
    { id: 'f', type: 'file', title: 'Projeto', fileName: 'p.zip', fileSize: 10, mimeType: null },
    { id: 'l', type: 'link', title: null, url: 'https://slides.dev/' },
  ];

  it('com acesso (comprou o curso): devolve tudo intacto', () => {
    expect(lockForPreview(materials, true)).toBe(materials);
  });

  it('sem acesso: vídeo e texto abertos; arquivo e link bloqueados, sem endereço', () => {
    const out = lockForPreview(materials, false);
    expect(out.map((m) => m.type)).toEqual(['video', 'text', 'locked', 'locked']);
    expect(out[2]).toEqual({ id: 'f', type: 'locked', kind: 'file', title: 'Projeto' });
    expect(out[3]).toEqual({ id: 'l', type: 'locked', kind: 'link', title: null });
    expect(JSON.stringify(out)).not.toMatch(/slides\.dev|p\.zip/);
  });

  it('sem acesso: links do Instagram e do site da Scorpion Bits continuam abertos', () => {
    const links: PlayerMaterial[] = [
      { id: 'i', type: 'link', title: null, url: 'https://www.instagram.com/scorpionbits_' },
      { id: 's', type: 'link', title: null, url: 'https://scorpionbits.com/' },
      {
        id: 'g',
        type: 'link',
        title: 'Material',
        url: 'https://scorpion-bits-account.github.io/mini-curso-astrodash/',
      },
      { id: 'x', type: 'link', title: null, url: 'https://scorpionbits.com.evil.dev/' },
    ];
    expect(lockForPreview(links, false).map((m) => m.type)).toEqual([
      'link',
      'link',
      'locked',
      'locked',
    ]);
  });
});
