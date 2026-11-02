# Autorização

## Papéis
| papel | origem | capacidades |
|---|---|---|
| `student` | automático no cadastro | ver catálogo, comprar, consumir cursos com acesso, registrar o próprio progresso, editar o próprio perfil |
| `admin` | **somente** via SQL/service role (`supabase/scripts/grant-admin.sql`) | tudo acima + gerenciar cursos/conteúdo, alunos, matrículas, pedidos, métricas |

Anônimo: catálogo e páginas de curso publicados, ementa pública, materiais de aulas `is_preview`.

## Camadas (todas obrigatórias)
1. **Banco (RLS + funções)** — a única camada que um atacante não contorna.
2. **Servidor Next** — `requireUser`/`requireAdmin` em layouts **e** em cada Server Action; validação `zod` de todo input.
3. **UI** — esconder o que não se pode fazer (conveniência, nunca segurança).

## Matriz de RLS (resumo)
| tabela | anon | student | admin |
|---|---|---|---|
| profiles | — | SELECT/UPDATE própria linha (colunas permitidas) | SELECT todos |
| user_roles | — | SELECT própria | SELECT todos (escrita só service role) |
| categories | SELECT | SELECT | ALL |
| courses | SELECT `published` | SELECT `published` (+ cursos com acesso mesmo se `archived`; rascunho nunca, mesmo com atribuição) | ALL |
| course_modules / lessons | SELECT se curso `published` (só metadados de ementa) | idem + cursos com acesso (`archived`) | ALL |
| lesson_materials | SELECT se aula `is_preview` e curso publicado | SELECT se `has_course_access(course_id)` ou preview (a flag `show_in_all_lessons` não altera isso: vale a aula de origem) | ALL |
| enrollments | — | SELECT próprias | SELECT todas; INSERT só `admin_grant` com `granted_by = auth.uid()`; UPDATE só colunas de revogação com `revoked_by = auth.uid()`; **sem DELETE** (histórico permanente). `purchase` só via `fulfill_order`/`admin_record_manual_sale` |
| orders | — | SELECT próprios. **Sem escrita direta**: pedidos são criados/atualizados apenas pelo servidor (Server Action `startCheckout` com service client em módulo `server-only`, após `requireUser` + zod; preço lido do banco) e pelo webhook | SELECT todos; venda manual via `admin_record_manual_sale()` (Server Action admin). Pedido de reembolso do aluno via `request_refund()` (até 7 dias, antiabuso) |
| payment_events | — | — | SELECT |
| lesson_progress | — | ALL nas próprias linhas **se** `has_course_access(course_id)` | SELECT todos |
| storage `course-covers` | leitura pela URL pública do bucket (sem policy SELECT; não lista) | idem | ALL |
| storage `course-content` | — | — (signed URL do servidor) | ALL |

Implementação: `supabase/migrations/20261008000003_rls_functions.sql` (grants mínimos por tabela/coluna + policies por papel; funções em `docs/database.md` §4). Pontos que um atacante tentaria e o banco bloqueia: escrita em `user_roles` (só service role/`grant-admin.sql`), `role` no metadata do cadastro (ignorado), UPDATE de colunas de `profiles` fora de `full_name/avatar_url/tax_id/phone`, qualquer escrita em `orders`/`payment_events` por `authenticated`, `fulfill_order`/`refund_order`/`anonymize_user` (só `service_role`), edição de perfil já excluído (`deleted_at`), progresso em curso sem acesso ou em nome de outro usuário.

## Checklist "usuário malicioso" (aplicar a toda feature)
- [ ] Chamando a REST do Supabase direto com a publishable key e meu JWT, consigo ler/escrever algo fora do meu escopo?
- [ ] Chamando a Server Action direto (ela é um endpoint POST público) com IDs de outro usuário/curso, o que acontece?
- [ ] Trocar IDs na URL revela dados de outro usuário?
- [ ] Algum segredo está em `NEXT_PUBLIC_*` ou em bundle de client?
- [ ] Resposta com dado privado tem `Cache-Control: private, no-store`?
- [ ] Algum valor monetário vem do cliente? (Nunca deve.)

Toda tarefa que toca dados deve ter testes pgTAP de RLS (`supabase/tests/`) cobrindo pelo menos anon, student sem acesso, student com acesso e admin.
