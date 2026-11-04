'use client';

import { useViewer } from '@/features/viewer/ViewerProvider';

import { CourseView } from './CourseView';
import type { CourseViewProps } from './CourseView';

/**
 * Página do curso em cache: o HTML sai como visitante e, no navegador, ajusta
 * "logado" e "já tenho este curso". O acesso de verdade é checado no checkout/player.
 */
export function CourseViewLive(props: Omit<CourseViewProps, 'signedIn' | 'hasAccess'>) {
  const { status, ownedCourseIds } = useViewer();
  return (
    <CourseView
      {...props}
      signedIn={status === 'user'}
      hasAccess={ownedCourseIds.includes(props.course.id)}
    />
  );
}
