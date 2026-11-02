import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Skeleton, Tabs } from '@/components/ui';
import courseStudentStyles from '@/features/course-students/components/CourseStudents.module.css';
import { CourseStudentsPanel } from '@/features/course-students/components/CourseStudentsPanel';
import { CourseForm } from '@/features/courses/components/CourseForm';
import { StatusControl } from '@/features/courses/components/StatusControl';
import { getAdminCourse, listCategories } from '@/features/courses/queries';
import { formatCentsForInput } from '@/features/courses/schemas';
import { parseLessonParam } from '@/features/curriculum/expansion';
import { SyllabusPanel } from '@/features/curriculum/components/SyllabusPanel';
import { parseListParams } from '@/features/students/schemas';
import { getCoverPublicUrl } from '@/features/materials/storage';

import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Editar curso' };

export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; aula?: string | string[]; q?: string; pagina?: string }>;
}) {
  const [{ id }, { tab, aula, ...listRaw }] = await Promise.all([params, searchParams]);
  const [course, categories] = await Promise.all([getAdminCourse(id), listCategories()]);
  if (!course) notFound();

  const openLessonId = parseLessonParam(aula);

  const info = (
    <div className={styles.layout}>
      <div className={styles.statusBox}>
        <StatusControl
          courseId={course.id}
          status={course.status}
          title={course.title}
          priceCents={course.price_cents}
          coverPath={course.cover_path}
          lessonCount={course.lessonCount}
        />
      </div>
      <CourseForm
        categories={categories}
        course={{
          id: course.id,
          title: course.title,
          slug: course.slug,
          subtitle: course.subtitle ?? '',
          description: course.description ?? '',
          categoryId: course.category_id ?? '',
          level: course.level,
          price: course.price_cents > 0 ? formatCentsForInput(course.price_cents) : '',
          coverPath: course.cover_path ?? '',
          coverUrl: getCoverPublicUrl(course.cover_path),
        }}
      />
    </div>
  );

  const syllabus = (
    <Suspense
      fallback={
        <div className={styles.skel} role="status" aria-label="Carregando ementa">
          <Skeleton height="3.5rem" />
          <Skeleton height="3.5rem" />
          <Skeleton height="3.5rem" />
        </div>
      }
    >
      <SyllabusPanel courseId={course.id} openLessonId={openLessonId} />
    </Suspense>
  );

  const { q, page } = parseListParams(listRaw);
  const students = (
    <Suspense
      key={`${q}|${page}`}
      fallback={
        <div className={courseStudentStyles.skel} role="status" aria-label="Carregando alunos">
          <Skeleton height="2.75rem" width="24rem" />
          <Skeleton height="3.5rem" />
          <Skeleton height="3.5rem" />
          <Skeleton height="3.5rem" />
        </div>
      }
    >
      <CourseStudentsPanel courseId={course.id} q={q} page={page} />
    </Suspense>
  );

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/admin/cursos">
        ← Cursos
      </Link>
      <h1 className={styles.title}>{course.title}</h1>
      <Tabs
        label="Seções do curso"
        defaultValue={
          tab === 'syllabus' || tab === 'students' ? tab : openLessonId ? 'syllabus' : 'info'
        }
        items={[
          { value: 'info', label: 'Informações', panel: info },
          { value: 'syllabus', label: 'Ementa', panel: syllabus },
          { value: 'students', label: 'Alunos', panel: students },
        ]}
      />
    </div>
  );
}
