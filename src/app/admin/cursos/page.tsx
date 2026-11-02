import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, Button, EmptyState, Table } from '@/components/ui';
import type { TableColumn } from '@/components/ui';
import { STATUS_TONES } from '@/features/courses/components/StatusControl';
import { listAdminCourses } from '@/features/courses/queries';
import type { AdminCourseRow } from '@/features/courses/queries';
import { STATUS_LABELS } from '@/features/courses/schemas';

import styles from './page.module.css';

export const metadata: Metadata = { title: 'Cursos' };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const COLUMNS: TableColumn<AdminCourseRow>[] = [
  {
    key: 'title',
    header: 'Título',
    render: (c) => (
      <span className={styles.titleCell}>
        <Link className={styles.link} href={`/admin/cursos/${c.id}`}>
          {c.title}
        </Link>
        <span className={styles.slug}>/{c.slug}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (c) => <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>,
  },
  { key: 'price', header: 'Preço', render: (c) => brl.format(c.priceCents / 100), align: 'end' },
  { key: 'lessons', header: 'Aulas', render: (c) => c.lessonCount, align: 'end' },
  { key: 'students', header: 'Alunos', render: (c) => c.studentCount, align: 'end' },
  {
    key: 'actions',
    header: <span className={styles.srOnly}>Ações</span>,
    label: 'Ações',
    align: 'end',
    render: (c) => (
      <span className={styles.actions}>
        <Button
          href={`/admin/cursos/${c.id}`}
          size="sm"
          variant="secondary"
          aria-label={`Editar curso ${c.title}`}
        >
          Editar
        </Button>
        <Button
          href={`/admin/cursos/${c.id}?tab=syllabus`}
          size="sm"
          variant="ghost"
          aria-label={`Ementa e aulas de ${c.title}`}
        >
          Aulas
        </Button>
      </span>
    ),
  },
];

export default async function AdminCoursesPage() {
  const courses = await listAdminCourses();
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Cursos</h1>
        <Button href="/admin/cursos/novo">Novo curso</Button>
      </div>
      {courses.length === 0 ? (
        <EmptyState
          title="Nenhum curso ainda"
          description="Crie o primeiro curso para começar a montar a ementa."
          action={<Button href="/admin/cursos/novo">Criar curso</Button>}
        />
      ) : (
        <Table caption="Cursos" columns={COLUMNS} rows={courses} getRowKey={(c) => c.id} />
      )}
    </div>
  );
}
