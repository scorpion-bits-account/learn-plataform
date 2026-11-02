# ADMIN-010 — Material "em todas as aulas" do curso

**Agente:** A05 — Admin/Player · **Modelo:** Sonnet 5.5 · **Esforço:** alto

## Por quê
Pedido do produto: cadastrar um material (ex.: link dos slides, arquivo do projeto) **uma vez** e ativar uma opção para ele aparecer em **todas as aulas** do curso.

## Desenho (decidido)
- Nova coluna `lesson_materials.show_in_all_lessons boolean not null default false`. O material continua pertencendo a uma aula (a "aula de origem"); com a flag, o **player** o mostra em toda aula do mesmo curso.
- **Acesso não muda:** a RLS atual de `lesson_materials` (acesso ao curso, ou aula de origem em prévia de curso publicado) continua decidindo. Consequência aceita: material "em todas as aulas" cadastrado numa aula **não**-prévia não aparece para visitante numa aula de prévia; cadastrado numa aula de prévia, é público. Documente isso no texto de ajuda do toggle.
- Download de arquivo (signed URL) continua pela checagem existente do material (grep `downloadMaterial` em `src/features/player/`): confirme que ela valida pelo `course_id`/acesso do material e não exige que o material seja da aula aberta; ajuste se exigir.

## Leia (somente isto)
- `CLAUDE.md`; `docs/database.md` (grep `lesson_materials`), `docs/authorization.md` (linha lesson_materials)
- `supabase/migrations/20261008000001_core_schema.sql` (tabela) e `20261008000003_rls_functions.sql` (grants/policies de `lesson_materials`: grep `lesson_materials`)
- Admin: `src/features/materials/{schemas,actions,model,queries}.ts`, `components/{MaterialForm,MaterialItem,MaterialsEditor}.tsx`
- Player: `src/features/player/queries.ts` (grep `lesson_materials`), componentes de materiais em `src/features/player/components/`
- `src/types/database.ts`

## Entregas
1. **Migration** `supabase/migrations/20261102000011_course_wide_materials.sql`: coluna + grant de INSERT/UPDATE da coluna para `authenticated` (seguindo o padrão de grants por coluna existente) + índice parcial `(course_id) where show_in_all_lessons`. Teste pgTAP `supabase/tests/13_course_wide_materials.test.sql`: coluna existe com default false; admin grava a flag; aluno sem acesso não lê material com flag; aluno com acesso lê; anon numa aula de prévia não lê material com flag de aula não-prévia. Atualize `src/types/database.ts` e `docs/database.md`.
2. **Admin:** no `MaterialForm`, toggle **"Mostrar em todas as aulas do curso"** (texto de ajuda curto, incluindo a regra de prévia). Schema zod e actions gravam o campo. No `MaterialItem`, selo **"Todas as aulas"** quando ligado. O resumo da aula na ementa (ADMIN-009, `summarizeMaterials`) continua contando o material só na aula de origem.
3. **Player:** na aula aberta, além dos materiais da própria aula, mostrar uma seção **"Materiais do curso"** com os materiais `show_in_all_lessons` do curso que **não** são desta aula (sem duplicar na aula de origem), na ordem: posição do módulo, posição da aula, posição do material. Uma consulta, sem N+1. Estados vazio (seção some) e mobile 360px.
4. Testes Vitest: schema/action com o campo; mapeamento/ordenação da seção do player.
5. E2E: se couber de forma simples, em `e2e/admin-course.spec.ts` marcar o material de texto como "todas as aulas" não é obrigatório — priorize não quebrar os specs existentes (rótulos atuais).

## Não fazer
- Não alterar policies de RLS existentes, pagamentos, ou o fluxo de upload. Sem libs novas.
- Não editar `MASTER_PLAN.md`/`docs/changelog.md`. Não commitar.

## Pronto quando
`npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` verdes; pgTAP completo verde num DB limpo próprio (`cw011`; harness em `/tmp/claude-0/-home-user-learn-plataform/d815b849-49f4-599a-a15c-8d6daf74274c/scratchpad/harness.sql`, `create extension pgtap schema extensions`, migrations em ordem; Postgres local: veja `docs/briefs/QA-002.md` "Ferramentas locais"). Screenshots 360/1440 do toggle no admin e da seção no player (vitrines `/dev/*`) em `/tmp/claude-0/-home-user-learn-plataform/d815b849-49f4-599a-a15c-8d6daf74274c/scratchpad/admin-010/`.
