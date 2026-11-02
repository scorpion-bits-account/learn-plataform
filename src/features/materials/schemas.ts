import { z } from 'zod';

/**
 * Regras puras (sem server-only) dos materiais de aula: compartilhadas pela action,
 * pela UI e pelos testes. Espelham as constraints de `lesson_materials` e o bucket
 * `course-content` (docs/database.md §3.1 e §6).
 */

export const CONTENT_BUCKET_NAME = 'course-content';

export const TITLE_MAX = 200;
export const BODY_MAX = 50_000;
export const URL_MAX = 2048;
export const FILE_NAME_MAX = 255;
/** Limite do bucket `course-content` (200 MB). */
export const FILE_MAX_BYTES = 209_715_200;
/** Teto de itens numa reordenação. */
export const REORDER_MAX_ITEMS = 200;

export const MATERIAL_TYPES = ['video', 'text', 'file', 'link'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  video: 'Vídeo',
  text: 'Texto',
  file: 'Arquivo',
  link: 'Link',
};

/** Mesma lista de `allowed_mime_types` do bucket (migration 20261008000004), sem curingas. */
export const FILE_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/octet-stream',
  'application/json',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'model/gltf-binary',
  'model/gltf+json',
  'model/obj',
] as const;

export function isAllowedMime(mime: string): boolean {
  return (FILE_MIME_TYPES as readonly string[]).includes(mime);
}

/* ------------------------------------------------------------------- vídeo */

export type VideoRef = { provider: 'youtube' | 'vimeo'; videoId: string };

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{1,32}$/;

function parseYoutube(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | undefined;
  if (url.hostname === 'youtu.be') {
    candidate = segments.length === 1 ? segments[0] : undefined;
  } else if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  } else if (segments.length === 1 && segments[0] === 'watch') {
    candidate = url.searchParams.get('v') ?? undefined;
  } else if (segments.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(segments[0]!)) {
    candidate = segments[1];
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function parseVimeo(url: URL): string | null {
  if (!VIMEO_HOSTS.has(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const player = url.hostname === 'player.vimeo.com';
  let rest: string[];
  if (player) {
    if (segments[0] !== 'video') return null;
    rest = segments.slice(1);
  } else if (segments[0] === 'channels' || segments[0] === 'groups') {
    // vimeo.com/channels/<canal>/<id> · vimeo.com/groups/<grupo>/videos/<id>
    const at = segments[0] === 'channels' ? 2 : 3;
    if (segments[0] === 'groups' && segments[2] !== 'videos') return null;
    rest = segments.slice(at);
  } else {
    rest = segments;
  }
  const [id, pathHash, ...extra] = rest;
  if (!id || extra.length > 0 || !VIMEO_ID.test(id)) return null;
  const hash = pathHash ?? url.searchParams.get('h') ?? undefined;
  if (hash === undefined) return id;
  return VIMEO_HASH.test(hash) ? `${id}/${hash}` : null;
}

/**
 * Extrai provedor + id de uma URL colada pelo admin. Só YouTube e Vimeo, só http(s),
 * sem credenciais, e o host precisa bater EXATAMENTE (youtube.com.evil.com é recusado).
 * O id devolvido sempre respeita o check `lesson_materials_video_id_format`.
 */
export function parseVideoUrl(raw: string): VideoRef | null {
  const value = raw.trim();
  if (value === '' || value.length > URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const youtube = parseYoutube(url);
  if (youtube) return { provider: 'youtube', videoId: youtube };
  const vimeo = parseVimeo(url);
  if (vimeo) return { provider: 'vimeo', videoId: vimeo };
  return null;
}

/** URL canônica para exibir/editar um vídeo salvo (`null` para provedores sem URL pública, ex.: bunny). */
export function videoUrlFor(provider: string | null, videoId: string | null): string | null {
  if (!provider || !videoId) return null;
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${videoId}`;
  if (provider === 'vimeo') return `https://vimeo.com/${videoId}`;
  return null;
}

export const VIDEO_PROVIDER_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  bunny: 'Bunny',
};

/* ----------------------------------------------------------------- arquivo */

/** Nome seguro para a chave do Storage: ASCII, sem "..", sem barras, extensão preservada. */
export function sanitizeFileName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '');
  const dot = ascii.lastIndexOf('.');
  const ext = dot > 0 ? ascii.slice(dot, dot + 17) : '';
  const stem = (dot > 0 ? ascii.slice(0, dot) : ascii).replace(/[.-]+$/, '').slice(0, 100);
  const safe = `${stem}${ext}`;
  return safe === '' || safe === ext ? `arquivo${ext}` : safe;
}

/** `<courseId>/<lessonId>/<uuid>-<nome-sanitizado>` */
export function buildStoragePath(
  courseId: string,
  lessonId: string,
  fileName: string,
  uuid: string = crypto.randomUUID(),
): string {
  return `${courseId}/${lessonId}/${uuid}-${sanitizeFileName(fileName)}`;
}

const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,130}$/;

/** O caminho pertence a esta aula (prefixo exato + formato do último segmento)? */
export function isPathInLesson(path: string, courseId: string, lessonId: string): boolean {
  const prefix = `${courseId}/${lessonId}/`;
  if (!path.startsWith(prefix) || path.length > 1024) return false;
  const rest = path.slice(prefix.length);
  return STORED_NAME.test(rest) && !rest.includes('..');
}

/** Validação (cliente e servidor) de tipo e tamanho; devolve a mensagem de erro ou `null`. */
export function validateFile(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return 'O arquivo está vazio.';
  if (file.size > FILE_MAX_BYTES) return 'O arquivo pode ter no máximo 200 MB.';
  if (!isAllowedMime(mimeOf(file))) {
    return 'Tipo de arquivo não permitido. Use zip, imagens, áudio, vídeo, fontes, modelos 3D ou texto/dados.';
  }
  return null;
}

/** Navegadores deixam `type` vazio em extensões desconhecidas (.unitypackage, .blend...). */
export function mimeOf(file: { type: string }): string {
  return file.type.trim().toLowerCase() || 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

/* ------------------------------------------------------------------- zod */

const id = z.uuid('Identificador inválido.');

const optionalTitle = z
  .string()
  .trim()
  .max(TITLE_MAX, `No máximo ${TITLE_MAX} caracteres.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null);

const requiredTitle = z
  .string()
  .trim()
  .min(1, 'Informe o título.')
  .max(TITLE_MAX, `No máximo ${TITLE_MAX} caracteres.`);

/** "Mostrar em todas as aulas do curso" (ADMIN-010). */
const showInAll = z.boolean();

const videoUrl = z
  .string()
  .trim()
  .min(1, 'Cole a URL do vídeo.')
  .max(URL_MAX, 'URL longa demais.')
  .refine((value) => parseVideoUrl(value) !== null, 'Use uma URL de vídeo do YouTube ou do Vimeo.');

const linkUrl = z
  .string()
  .trim()
  .min(1, 'Informe a URL.')
  .max(URL_MAX, 'URL longa demais.')
  .refine((value) => {
    if (!/^https?:\/\/\S+$/i.test(value)) return false;
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
    } catch {
      return false;
    }
  }, 'Use uma URL começando com http:// ou https://.');

const body = z
  .string()
  .refine((value) => value.trim() !== '', 'Escreva o texto.')
  .max(BODY_MAX, `No máximo ${BODY_MAX} caracteres.`);

/** Metadados de um arquivo que o cliente já enviou ao Storage. */
export const uploadedFileSchema = z.object({
  storagePath: z.string().min(1).max(1024),
  fileName: z
    .string()
    .trim()
    .min(1, 'Nome do arquivo ausente.')
    .max(FILE_NAME_MAX)
    .refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value), 'Nome de arquivo inválido.'),
  fileSize: z
    .number()
    .int()
    .min(1, 'O arquivo está vazio.')
    .max(FILE_MAX_BYTES, 'O arquivo pode ter no máximo 200 MB.'),
  mimeType: z.string().refine(isAllowedMime, 'Tipo de arquivo não permitido.'),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

export const createMaterialSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video'),
    lessonId: id,
    title: optionalTitle,
    showInAllLessons: showInAll.default(false),
    url: videoUrl,
  }),
  z.object({
    type: z.literal('text'),
    lessonId: id,
    title: optionalTitle,
    showInAllLessons: showInAll.default(false),
    body,
  }),
  z.object({
    type: z.literal('link'),
    lessonId: id,
    title: requiredTitle,
    showInAllLessons: showInAll.default(false),
    url: linkUrl,
  }),
  z.object({
    type: z.literal('file'),
    lessonId: id,
    title: optionalTitle,
    showInAllLessons: showInAll.default(false),
    file: uploadedFileSchema,
  }),
]);
export type CreateMaterialInput = z.input<typeof createMaterialSchema>;

/** O `type` precisa coincidir com o do material salvo (a action confere): trocar tipo = excluir e criar. */
export const updateMaterialSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video'),
    id,
    title: optionalTitle,
    /** Ausente = mantém o valor atual. */
    showInAllLessons: showInAll.optional(),
    /** Ausente = mantém o vídeo atual (ex.: provedor sem URL pública). */
    url: videoUrl.optional(),
  }),
  z.object({
    type: z.literal('text'),
    id,
    title: optionalTitle,
    showInAllLessons: showInAll.optional(),
    body,
  }),
  z.object({
    type: z.literal('link'),
    id,
    title: requiredTitle,
    showInAllLessons: showInAll.optional(),
    url: linkUrl,
  }),
  z.object({
    type: z.literal('file'),
    id,
    title: optionalTitle,
    /** Ausente = mantém o valor atual. */
    showInAllLessons: showInAll.optional(),
    /** Presente = troca o arquivo (o objeto antigo é removido). */
    file: uploadedFileSchema.optional(),
  }),
]);
export type UpdateMaterialInput = z.input<typeof updateMaterialSchema>;

export const deleteMaterialSchema = z.object({ id });

const orderedIds = z
  .array(id)
  .min(1, 'Lista vazia.')
  .max(REORDER_MAX_ITEMS)
  .refine((list) => new Set(list).size === list.length, 'Lista com ids repetidos.');

export const reorderMaterialsSchema = z.object({ lessonId: id, ids: orderedIds });

export const discardUploadSchema = z.object({
  lessonId: id,
  storagePath: z.string().min(1).max(1024),
});
