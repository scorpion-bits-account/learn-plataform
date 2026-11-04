import 'server-only';

import { revalidatePath } from 'next/cache';

/**
 * Landing, /cursos e /cursos/[slug] ficam em cache (ISR). Ao salvar curso, preço ou
 * ementa no admin, invalida tudo de uma vez (edições são raras): a mudança aparece já.
 */
export function revalidatePublicPages(): void {
  revalidatePath('/', 'layout');
}
