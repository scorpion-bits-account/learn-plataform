# ADMIN-009 — Editar aulas e materiais numa tela só (Ementa)

**Agente:** A05 — Admin · **Modelo:** Sonnet 5.5 · **Esforço:** alto

## Por quê
Feedback do produto: montar o curso é confuso porque cada aula exige sair da aba **Ementa** (`/admin/cursos/[id]?tab=syllabus`) para outra tela (`/admin/cursos/[id]/aulas/[lessonId]`) e voltar. O produto quer montar o curso inteiro sozinho, sem trocar de tela.

## Objetivo
Na aba Ementa, cada aula vira um item **expansível**: ao abrir, aparece ali mesmo o editor de materiais da aula (adicionar vídeo/texto/arquivo/link, editar, reordenar, excluir) — o mesmo `MaterialsEditor` que já existe. Nenhuma navegação para montar o curso.

## Leia (somente isto)
- `CLAUDE.md`; `docs/backlog.md` → `ADMIN-003`, `ADMIN-004` (critérios originais)
- `src/features/curriculum/components/{SyllabusPanel,CurriculumEditor,ModuleItem,LessonItem}.tsx` + `CurriculumEditor.module.css`, `src/features/curriculum/queries.ts`
- `src/features/materials/components/{MaterialsEditor,MaterialItem,MaterialForm,LazyMaterialForm}.tsx`, `src/features/materials/queries.ts` (`getLessonEditorData`, `EditorMaterial`), `src/features/materials/actions.ts` (grep `revalidatePath`)
- `src/app/admin/cursos/[id]/page.tsx` e `src/app/admin/cursos/[id]/aulas/[lessonId]/page.tsx`
- `e2e/admin-course.spec.ts` (usa o link `Materiais da aula "X" (0)` — vai mudar)

## Entregas
1. **Dados:** carregar os materiais de todas as aulas do curso numa consulta só (por `course_id`, ordenados) junto da ementa no `SyllabusPanel` (RLS admin já permite), mapeando para `EditorMaterial`. Sem N+1.
2. **UI da aula:** a linha da aula ganha um botão de expandir (o título da aula e o atual "Materiais (n)" passam a abrir/fechar o painel; `aria-expanded`/`aria-controls`). Fechada, mostra um resumo do conteúdo (ex.: "1 vídeo · 1 texto" ou "Sem conteúdo ainda", destacado). Aberta, renderiza `MaterialsEditor` inline para aquela aula.
3. **Estado na URL:** aula aberta em `?tab=syllabus&aula=<lessonId>` (sobrevive a recarregar/salvar); várias abertas não é necessário — uma por vez basta. Ao **criar uma aula**, ela já abre expandida para adicionar o conteúdo.
4. **Atualização:** ações de material devem revalidar também `/admin/cursos/[id]` (hoje revalidam a rota da aula) para a ementa refletir na hora (contadores/resumo).
5. A rota antiga `/admin/cursos/[id]/aulas/[lessonId]` continua funcionando (links antigos), mas a Ementa não depende mais dela. Se quiser, redirecione-a para `?tab=syllabus&aula=<id>`.
6. **Celular (360px):** painel inline usável com toque; formulário de material sem overflow.
7. **E2E:** atualize `e2e/admin-course.spec.ts` para o fluxo novo (abrir a aula na ementa e adicionar o material de texto ali). Mantenha os demais passos.
8. Testes Vitest para o mapeamento de dados novo e o estado de expansão (o que fizer sentido).

## Não fazer
- Não mudar banco/migrations/RLS, pagamentos, nem regras dos materiais (tipos, validação, upload). Sem libs novas.
- Não editar `MASTER_PLAN.md`/`docs/changelog.md`. Não commitar.

## Pronto quando
`npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` verdes; `npx playwright test --list` ok. Screenshots 360 e 1440 da ementa com uma aula aberta (vitrine `/dev/...` com dados falsos, como as outras) em `/tmp/claude-0/-home-user-learn-plataform/d815b849-49f4-599a-a15c-8d6daf74274c/scratchpad/admin-009/`.
