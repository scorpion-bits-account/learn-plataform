import 'server-only';
import { z } from 'zod';
import { getClientEnv } from '@/lib/env/client';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Acesso a arquivos do Storage (ADR-009, docs/database.md §6).
 *
 * - `course-content` é privado e não tem policy de leitura para alunos: o único
 *   caminho de download é a signed URL criada aqui, DEPOIS de ler o material com
 *   o client do usuário (a RLS de `lesson_materials` decide se ele tem acesso).
 * - O service client é usado só para assinar a URL, nunca para decidir acesso.
 * - Quem devolver a URL ao navegador (Route Handler / Server Action) deve
 *   responder com `Cache-Control: private, no-store`.
 */

export const CONTENT_BUCKET = 'course-content';
export const COVERS_BUCKET = 'course-covers';

/** Validade da signed URL de download (ADR-009: no máximo 10 minutos). */
export const SIGNED_URL_TTL_SECONDS = 600;

export type MaterialDownloadError =
  /** id malformado (input do cliente) */
  | 'invalid_id'
  /** material inexistente OU sem acesso (a RLS não distingue, de propósito) */
  | 'not_found'
  /** material existe, mas não é um arquivo para download (type !== 'file') */
  | 'not_a_file'
  /** falha ao consultar o banco ou ao assinar a URL no Storage */
  | 'unavailable';

export type MaterialDownload = {
  url: string;
  fileName: string;
  expiresInSeconds: number;
};

export type MaterialDownloadResult =
  { ok: true; data: MaterialDownload } | { ok: false; error: MaterialDownloadError };

const materialIdSchema = z.uuid();

/**
 * Gera uma signed URL curta para baixar o arquivo de um material, se o usuário
 * da sessão puder ler esse material (RLS) E tiver acesso ao curso (matrícula ativa
 * ou admin, `has_course_access`). Na prévia o arquivo aparece bloqueado.
 */
export async function getMaterialDownloadUrl(materialId: string): Promise<MaterialDownloadResult> {
  const parsed = materialIdSchema.safeParse(materialId);
  if (!parsed.success) return { ok: false, error: 'invalid_id' };

  const userClient = await createClient();
  const { data: material, error: readError } = await userClient
    .from('lesson_materials')
    .select('id, type, storage_path, file_name, course_id')
    .eq('id', parsed.data)
    .maybeSingle();

  if (readError) return { ok: false, error: 'unavailable' };
  if (!material) return { ok: false, error: 'not_found' };
  if (material.type !== 'file' || !material.storage_path) return { ok: false, error: 'not_a_file' };

  // Arquivo é só de quem tem acesso ao curso: a prévia mostra o item bloqueado (lockForPreview)
  // e o download também é recusado aqui, para não depender da interface.
  const { data: hasAccess, error: accessError } = await userClient.rpc('has_course_access', {
    p_course_id: material.course_id,
  });
  if (accessError) return { ok: false, error: 'unavailable' };
  if (hasAccess !== true) return { ok: false, error: 'not_found' };

  const fileName = material.file_name?.trim() || fallbackFileName(material.storage_path);

  const { data: signed, error: signError } = await createServiceClient()
    .storage.from(CONTENT_BUCKET)
    .createSignedUrl(material.storage_path, SIGNED_URL_TTL_SECONDS, { download: fileName });

  if (signError || !signed) return { ok: false, error: 'unavailable' };

  return {
    ok: true,
    data: { url: signed.signedUrl, fileName, expiresInSeconds: SIGNED_URL_TTL_SECONDS },
  };
}

/**
 * URL pública da capa (bucket público `course-covers`). Não consulta o banco nem
 * o Storage; `null` quando o curso não tem capa.
 */
export function getCoverPublicUrl(path: string | null | undefined): string | null {
  const clean = path?.trim();
  if (!clean) return null;

  const base = getClientEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  const encoded = clean
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${base}/storage/v1/object/public/${COVERS_BUCKET}/${encoded}`;
}

/** "{course}/{lesson}/{uuid}-{nome}" -> "{nome}" (sem o prefixo uuid). */
function fallbackFileName(storagePath: string): string {
  const last = storagePath.split('/').pop() ?? 'arquivo';
  return (
    last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || 'arquivo'
  );
}
