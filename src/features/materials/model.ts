import type { MaterialType } from './schemas';

/** Modelo puro do editor de materiais (sem acesso a dados): seguro para Server e Client. */

/** Linha serializável para o editor (sem `storage_path`: o cliente não precisa dele). */
export type EditorMaterial = {
  id: string;
  type: MaterialType;
  title: string | null;
  position: number;
  body: string | null;
  externalUrl: string | null;
  videoProvider: string | null;
  videoId: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
};

/** Colunas de `lesson_materials` lidas pelo editor (snake_case, como vêm do banco). */
export type MaterialRow = {
  id: string;
  type: MaterialType;
  title: string | null;
  position: number;
  body: string | null;
  external_url: string | null;
  video_provider: string | null;
  video_id: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
};

/** Lista de colunas do `select` que alimenta `MaterialRow`. */
export const MATERIAL_COLUMNS =
  'id, type, title, position, body, external_url, video_provider, video_id, file_name, file_size, mime_type';

export function toEditorMaterial(row: MaterialRow): EditorMaterial {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    position: row.position,
    body: row.body,
    externalUrl: row.external_url,
    videoProvider: row.video_provider,
    videoId: row.video_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
  };
}

/**
 * Agrupa as linhas (de várias aulas) por `lesson_id`, mantendo `position` crescente em cada
 * aula, independentemente da ordem de chegada. Aulas sem material simplesmente não aparecem.
 */
export function groupMaterialsByLesson(
  rows: readonly (MaterialRow & { lesson_id: string })[],
): Record<string, EditorMaterial[]> {
  const grouped: Record<string, EditorMaterial[]> = {};
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    (grouped[row.lesson_id] ??= []).push(toEditorMaterial(row));
  }
  return grouped;
}

const SUMMARY_LABELS: Record<MaterialType, [string, string]> = {
  video: ['vídeo', 'vídeos'],
  text: ['texto', 'textos'],
  file: ['arquivo', 'arquivos'],
  link: ['link', 'links'],
};
const SUMMARY_ORDER: MaterialType[] = ['video', 'text', 'file', 'link'];

/** "1 vídeo · 2 textos" ou `null` quando a aula não tem conteúdo. */
export function summarizeMaterials(
  materials: readonly Pick<EditorMaterial, 'type'>[],
): string | null {
  const parts = SUMMARY_ORDER.flatMap((type) => {
    const n = materials.filter((m) => m.type === type).length;
    if (n === 0) return [];
    const [one, many] = SUMMARY_LABELS[type];
    return [`${n} ${n === 1 ? one : many}`];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}
