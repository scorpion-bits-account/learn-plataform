import { z } from 'zod';

/** Estado de expansão das aulas da ementa, guardado na URL: `?tab=syllabus&aula=<lessonId>`. */

export const LESSON_PARAM = 'aula';

/** Lê `?aula=` (string, lista ou ausente) e devolve o id só se for um uuid válido. */
export function parseLessonParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Query string com a aula aberta (`lessonId`) ou fechada (`null`). Preserva os demais
 * parâmetros e garante `tab=syllabus`, para o link/reload cair na Ementa.
 */
export function withOpenLesson(search: string, lessonId: string | null): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'syllabus');
  if (lessonId) params.set(LESSON_PARAM, lessonId);
  else params.delete(LESSON_PARAM);
  return `?${params.toString()}`;
}

/** Alterna: clicar na aula já aberta fecha; outra aula abre (uma por vez). */
export function toggleLesson(current: string | null, lessonId: string): string | null {
  return current === lessonId ? null : lessonId;
}
