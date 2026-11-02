-- ADMIN-010 — Material "em todas as aulas" do curso.
--
-- O material continua pertencendo a uma aula (a "aula de origem"); com a flag, o player o
-- mostra em toda aula do mesmo curso. O ACESSO não muda: as policies de SELECT de
-- lesson_materials seguem decidindo (acesso ao curso, ou aula de origem em prévia de curso
-- publicado). Logo, material "em todas as aulas" de aula não-prévia não aparece para visitante.
--
-- Grants: lesson_materials já tem INSERT/UPDATE/DELETE em nível de TABELA para authenticated
-- (20261008000003), filtrados pelas policies de admin; a coluna nova é coberta por eles.
-- Não há grant por coluna a acrescentar (e nenhuma policy é alterada).

alter table public.lesson_materials
  add column show_in_all_lessons boolean not null default false;

comment on column public.lesson_materials.show_in_all_lessons is
  'Quando true, o player mostra o material em todas as aulas do curso (a aula de origem continua sendo lesson_id). O acesso segue a RLS da aula de origem.';

-- Consulta do player: materiais "do curso" de um curso, sem varrer os demais.
create index lesson_materials_course_wide_idx
  on public.lesson_materials (course_id)
  where show_in_all_lessons;
