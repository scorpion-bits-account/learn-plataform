-- 13 — material "em todas as aulas" do curso (ADMIN-010)
begin;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'aluno@test', '{"full_name":"Aluno"}'),
  ('00000000-0000-0000-0000-00000000000c', 'curioso@test', '{"full_name":"Sem acesso"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin');

insert into public.courses (id, slug, title, status, price_cents)
  values ('00000000-0000-0000-0000-0000000000c1', 'curso-x', 'Curso X', 'published', 1000);
insert into public.course_modules (id, course_id, title, position)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'M1', 0);
-- e1: prévia · e2: aula paga
insert into public.lessons (id, module_id, course_id, title, position, is_preview) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Prévia', 0, true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Paga', 1, false);
insert into public.enrollments (user_id, course_id, source, granted_by)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'admin_grant', '00000000-0000-0000-0000-00000000000a');

-- Materiais criados como dono do banco (a escrita do admin é testada abaixo).
insert into public.lesson_materials (id, lesson_id, type, position, external_url, title, show_in_all_lessons) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'link', 0, 'https://a.dev', 'Origem prévia', true),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', 'link', 0, 'https://b.dev', 'Origem paga', true),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e2', 'link', 1, 'https://c.dev', 'So da aula', false);

-- Linhas afetadas por um DML executado com o papel corrente.
create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.affected(text) to public;

-- estrutura
select has_column('public', 'lesson_materials', 'show_in_all_lessons', 'coluna show_in_all_lessons existe');
select col_default_is('public', 'lesson_materials', 'show_in_all_lessons', 'false', 'default false');
select col_not_null('public', 'lesson_materials', 'show_in_all_lessons', 'not null');
select is(
  (select show_in_all_lessons from public.lesson_materials where id = '00000000-0000-0000-0000-0000000000f3'),
  false, 'material sem a flag fica false');

-- anon: só materiais de aula de prévia; a flag NÃO amplia o acesso
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select is(
  (select string_agg(id::text, ',' order by id) from public.lesson_materials where show_in_all_lessons),
  '00000000-0000-0000-0000-0000000000f1',
  'anon: lê o material com flag de aula de prévia, não o de aula paga');
select is(
  (select count(*) from public.lesson_materials where id = '00000000-0000-0000-0000-0000000000f2'),
  0::bigint, 'anon: material com flag de aula não-prévia não é lido');

-- aluno sem acesso ao curso: idem (só a origem em prévia)
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.lesson_materials where id = '00000000-0000-0000-0000-0000000000f2'),
  0::bigint, 'sem acesso: não lê material com flag de aula paga');
select is(
  (select count(*) from public.lesson_materials where id = '00000000-0000-0000-0000-0000000000f1'),
  1::bigint, 'sem acesso: lê material com flag de aula de prévia');

-- aluno com acesso: lê todos os materiais com flag
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.lesson_materials where show_in_all_lessons),
  2::bigint, 'com acesso: lê os dois materiais com flag');

-- aluno não grava a flag (a policy de UPDATE é só de admin: 0 linhas afetadas)
select is(
  pg_temp.affected($$update public.lesson_materials set show_in_all_lessons = true where id = '00000000-0000-0000-0000-0000000000f3'$$),
  0::bigint, 'aluno: UPDATE da flag afeta 0 linhas');

-- admin grava a flag
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
update public.lesson_materials set show_in_all_lessons = true where id = '00000000-0000-0000-0000-0000000000f3';
select is(
  (select show_in_all_lessons from public.lesson_materials where id = '00000000-0000-0000-0000-0000000000f3'),
  true, 'admin: grava a flag');

select * from finish();
rollback;
