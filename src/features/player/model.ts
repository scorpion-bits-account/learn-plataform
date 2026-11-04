import { formatDuration } from '@/features/catalog/model';
import type { OutlineLesson, OutlineModule } from '@/features/catalog/model';

/**
 * Regras puras do player (sem I/O; testáveis sem mocks).
 * A autorização real é da RLS: aqui só decidimos o que MOSTRAR (estado da ementa, CTA).
 */

/* --------------------------------------------------------------- ementa */

export type FlatLesson = OutlineLesson & {
  moduleId: string;
  moduleTitle: string;
  /** 1-based, dentro do curso inteiro. */
  number: number;
  /** 1-based, dentro do módulo. */
  numberInModule: number;
  moduleNumber: number;
};

/** Módulos -> lista plana de aulas na ordem do curso. */
export function flattenOutline(modules: OutlineModule[]): FlatLesson[] {
  const flat: FlatLesson[] = [];
  modules.forEach((mod, moduleIndex) => {
    mod.lessons.forEach((lesson, lessonIndex) => {
      flat.push({
        ...lesson,
        moduleId: mod.id,
        moduleTitle: mod.title,
        moduleNumber: moduleIndex + 1,
        numberInModule: lessonIndex + 1,
        number: flat.length + 1,
      });
    });
  });
  return flat;
}

export type AccessInput = {
  /** `has_course_access` (matrícula ativa ou admin). */
  hasAccess: boolean;
  isPreview: boolean;
  /** Prévia só vale em curso publicado. */
  coursePublished: boolean;
};

/** A aula abre? Acesso ao curso OU prévia de curso publicado (a RLS já filtra os materiais). */
export function canOpenLesson({ hasAccess, isPreview, coursePublished }: AccessInput): boolean {
  return hasAccess || (isPreview && coursePublished);
}

export type LessonProgressRow = {
  lessonId: string;
  completedAt: string | null;
  updatedAt: string;
};

/**
 * Aula de retomada (somente entre as aulas que o usuário pode abrir):
 * 1) a de `lesson_progress` com `updated_at` mais recente;
 * 2) senão a primeira não concluída;
 * 3) senão a primeira.
 * `null` quando nenhuma aula abre (o chamador manda para a página do curso).
 */
export function resolveResumeLessonId(
  lessons: FlatLesson[],
  progress: LessonProgressRow[],
  access: { hasAccess: boolean; coursePublished: boolean },
): string | null {
  const openable = lessons.filter((l) => canOpenLesson({ ...access, isPreview: l.isPreview }));
  if (openable.length === 0) return null;

  const openableIds = new Set(openable.map((l) => l.id));
  let latest: LessonProgressRow | null = null;
  for (const row of progress) {
    if (!openableIds.has(row.lessonId)) continue;
    if (!latest || Date.parse(row.updatedAt) > Date.parse(latest.updatedAt)) latest = row;
  }
  if (latest) return latest.lessonId;

  const completed = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
  return (openable.find((l) => !completed.has(l.id)) ?? openable[0])!.id;
}

export type Neighbors = {
  prev: FlatLesson | null;
  next: FlatLesson | null;
  current: FlatLesson | null;
  total: number;
};

/**
 * Aula anterior/próxima entre as aulas que o usuário pode abrir (aluno sem compra
 * navega só pelas prévias; quem tem acesso, por todas). `current` é `null` se o id
 * não pertence ao curso.
 */
export function resolveNeighbors(
  lessons: FlatLesson[],
  currentId: string,
  access: { hasAccess: boolean; coursePublished: boolean },
): Neighbors {
  const current = lessons.find((l) => l.id === currentId) ?? null;
  const openable = lessons.filter(
    (l) => l.id === currentId || canOpenLesson({ ...access, isPreview: l.isPreview }),
  );
  const index = openable.findIndex((l) => l.id === currentId);
  return {
    current,
    total: lessons.length,
    prev: index > 0 ? (openable[index - 1] ?? null) : null,
    next: index >= 0 ? (openable[index + 1] ?? null) : null,
  };
}

export type LessonState = 'current' | 'completed' | 'locked' | 'available';

export type OutlineLessonView = {
  id: string;
  title: string;
  state: LessonState;
  /** Concluída (inclusive quando é a aula atual, que mostra `state: 'current'`). */
  completed: boolean;
  /** `null` quando bloqueada (não vira link). */
  href: string | null;
  durationLabel: string;
  isPreview: boolean;
};

export type OutlineModuleView = { id: string; title: string; lessons: OutlineLessonView[] };

/** Ementa com estado por aula: atual > bloqueada > concluída > disponível. */
export function buildOutlineView(
  modules: OutlineModule[],
  options: {
    currentId: string;
    access: { hasAccess: boolean; coursePublished: boolean };
    completedIds: ReadonlySet<string>;
    hrefFor: (lessonId: string) => string;
  },
): OutlineModuleView[] {
  const { currentId, access, completedIds, hrefFor } = options;
  return modules.map((mod) => ({
    id: mod.id,
    title: mod.title,
    lessons: mod.lessons.map((lesson) => {
      const open = canOpenLesson({ ...access, isPreview: lesson.isPreview });
      const state: LessonState =
        lesson.id === currentId
          ? 'current'
          : !open
            ? 'locked'
            : completedIds.has(lesson.id)
              ? 'completed'
              : 'available';
      return {
        id: lesson.id,
        title: lesson.title,
        state,
        completed: open && completedIds.has(lesson.id),
        href: open ? hrefFor(lesson.id) : null,
        durationLabel: formatDuration(lesson.durationSeconds),
        isPreview: lesson.isPreview,
      };
    }),
  }));
}

/* ---------------------------------------------------------------- vídeo */

export type VideoEmbed = {
  providerLabel: 'YouTube' | 'Vimeo';
  /** URL do iframe (domínio sem cookies; autoplay porque só carrega após o clique). */
  src: string;
  /** Miniatura pública do provedor; `null` quando não há sem chamar API. */
  thumbnailUrl: string | null;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// `lesson_materials_video_id_format`: "<id>" ou "<id>/<hash>" (vídeos não listados do Vimeo)
const VIMEO_ID = /^(\d{1,12})(?:\/([A-Za-z0-9]{1,32}))?$/;

/**
 * Provedor + id salvos no banco -> embed. `null` para provedor sem embed (ex.: bunny)
 * ou id fora do formato: nunca montamos URL a partir de dado não validado.
 */
export function buildVideoEmbed(
  provider: string | null | undefined,
  videoId: string | null | undefined,
): VideoEmbed | null {
  if (!provider || !videoId) return null;

  if (provider === 'youtube') {
    if (!YOUTUBE_ID.test(videoId)) return null;
    return {
      providerLabel: 'YouTube',
      src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  if (provider === 'vimeo') {
    const match = VIMEO_ID.exec(videoId);
    if (!match) return null;
    const [, id, hash] = match;
    const query = hash ? `h=${hash}&autoplay=1&dnt=1` : 'autoplay=1&dnt=1';
    return {
      providerLabel: 'Vimeo',
      src: `https://player.vimeo.com/video/${id}?${query}`,
      thumbnailUrl: null,
    };
  }

  return null;
}

/* -------------------------------------------------------------- materiais */

export type PlayerMaterial =
  | { id: string; type: 'video'; title: string | null; provider: string; videoId: string }
  | { id: string; type: 'text'; title: string | null; body: string }
  | {
      id: string;
      type: 'file';
      title: string | null;
      fileName: string;
      fileSize: number | null;
      mimeType: string | null;
    }
  | { id: string; type: 'link'; title: string | null; url: string }
  /**
   * Arquivo/link de quem ainda não comprou (aula de prévia): só o título vai ao navegador;
   * o clique leva para `/cursos/[slug]/acesso`. Ver `lockForPreview`.
   */
  | { id: string; type: 'locked'; kind: 'file' | 'link'; title: string | null };

/** Links que ficam abertos mesmo sem a compra: perfis e site da Scorpion Bits (decisão do produto). */
const OPEN_LINK_DOMAINS = ['instagram.com', 'scorpionbits.com'] as const;

/** `true` se o link é do Instagram ou do site da Scorpion Bits (domínio ou subdomínio). */
export function isOpenLink(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return OPEN_LINK_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Sem acesso ao curso (prévia), arquivos e links viram itens bloqueados: o vídeo e o texto da
 * aula de prévia continuam abertos, e links do Instagram/site também. Com acesso (comprou o
 * curso, ou admin), a lista volta intacta.
 */
export function lockForPreview(materials: PlayerMaterial[], hasAccess: boolean): PlayerMaterial[] {
  if (hasAccess) return materials;
  return materials.map((m) =>
    m.type === 'file' || (m.type === 'link' && !isOpenLink(m.url))
      ? { id: m.id, type: 'locked', kind: m.type, title: m.title }
      : m,
  );
}

export type MaterialRow = {
  id: string;
  type: 'video' | 'text' | 'file' | 'link';
  title: string | null;
  body: string | null;
  external_url: string | null;
  video_provider: string | null;
  video_id: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string | null;
};

/** Linha do banco -> material para o cliente (sem `storage_path`). Linhas incompletas são descartadas. */
export function mapMaterialRow(row: MaterialRow): PlayerMaterial | null {
  const title = row.title?.trim() || null;
  switch (row.type) {
    case 'video':
      return row.video_provider && row.video_id
        ? { id: row.id, type: 'video', title, provider: row.video_provider, videoId: row.video_id }
        : null;
    case 'text':
      return row.body?.trim() ? { id: row.id, type: 'text', title, body: row.body } : null;
    case 'file': {
      if (!row.storage_path) return null;
      const fileName = row.file_name?.trim() || fileNameFromPath(row.storage_path);
      return {
        id: row.id,
        type: 'file',
        title,
        fileName,
        fileSize: row.file_size,
        mimeType: row.mime_type,
      };
    }
    case 'link': {
      const url = safeExternalUrl(row.external_url);
      return url ? { id: row.id, type: 'link', title, url } : null;
    }
    default:
      return null;
  }
}

export type CourseMaterialRow = MaterialRow & { lesson_id: string; position: number };

/**
 * Materiais "em todas as aulas" (ADMIN-010) para a aula aberta: tira os da própria aula
 * (já aparecem na lista dela, sem duplicar) e ordena por posição do módulo, da aula e do
 * material, usando a ordem da ementa (`lessons` já vem ordenada). Aula fora da ementa vai
 * para o fim, de forma estável.
 */
export function buildCourseMaterials(
  rows: readonly CourseMaterialRow[],
  lessons: readonly Pick<FlatLesson, 'id'>[],
  currentLessonId: string,
): PlayerMaterial[] {
  const order = new Map(lessons.map((l, index) => [l.id, index]));
  return rows
    .filter((row) => row.lesson_id !== currentLessonId)
    .map((row, arrival) => ({ row, arrival }))
    .sort(
      (a, b) =>
        (order.get(a.row.lesson_id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.row.lesson_id) ?? Number.MAX_SAFE_INTEGER) ||
        a.row.position - b.row.position ||
        a.arrival - b.arrival,
    )
    .map(({ row }) => mapMaterialRow(row))
    .filter((m): m is PlayerMaterial => m !== null);
}

/** "{curso}/{aula}/{uuid}-{nome}" -> "{nome}". */
function fileNameFromPath(storagePath: string): string {
  const last = storagePath.split('/').pop() ?? '';
  return (
    last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || 'arquivo'
  );
}

/** Só http(s) sem credenciais; qualquer outra coisa (javascript:, data:) vira `null`. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "example.com" a partir de uma URL externa (sem `www.`). */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Bytes -> "1,4 MB". `null`/inválido -> "". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${text.replace('.', ',')} ${units[unit]}`;
}

/* ----------------------------------------------------------- texto inline */

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'link'; text: string; href: string };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\s][^*\n]*?)\*/g;

/**
 * Marcação inline mínima do texto de aula -> tokens (`code`, **negrito**, *itálico*,
 * [texto](https://...)). Sem HTML: quem renderiza usa elementos React, que escapam o texto.
 * Links com esquema que não seja http(s) viram texto puro.
 */
export function tokenizeInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: 'text', text: source.slice(last, index) });
    const [whole, code, strong, linkText, linkHref, em] = match;
    if (code !== undefined) tokens.push({ type: 'code', text: code });
    else if (strong !== undefined) tokens.push({ type: 'strong', text: strong });
    else if (linkText !== undefined && linkHref !== undefined) {
      const href = safeExternalUrl(linkHref);
      tokens.push(href ? { type: 'link', text: linkText, href } : { type: 'text', text: whole });
    } else if (em !== undefined) tokens.push({ type: 'em', text: em });
    last = index + whole.length;
  }
  if (last < source.length) tokens.push({ type: 'text', text: source.slice(last) });
  return tokens;
}

/* --------------------------------------------------------------- atalhos */

export type ShortcutAction = 'prev' | 'next';

export type ShortcutEventLike = {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
};

/**
 * Atalhos do player: `[` aula anterior · `]` próxima aula · `Alt+Shift+←` / `Alt+Shift+→`
 * (alternativa para teclados em que `[`/`]` exigem AltGr). Ignora Ctrl/Cmd (atalhos do
 * navegador), repetição e digitação em campos de formulário.
 */
export function shortcutAction(event: ShortcutEventLike): ShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey) return null;

  const target = event.target as
    { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tag = target?.tagName?.toUpperCase();
  if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return null;
  }

  if (!event.altKey && !event.shiftKey) {
    if (event.key === '[') return 'prev';
    if (event.key === ']') return 'next';
    return null;
  }
  if (event.altKey && event.shiftKey) {
    if (event.key === 'ArrowLeft') return 'prev';
    if (event.key === 'ArrowRight') return 'next';
  }
  return null;
}
