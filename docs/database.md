# Banco de dados

> Postgres (Supabase). Toda mudança via `supabase/migrations/*.sql`. Nunca editar schema pelo dashboard.
> Status: §1–3 **implementados** em `supabase/migrations/20261008000001_core_schema.sql` (DB-001) e `20261008000002_access_commerce.sql` (DB-002); §4–5 em `20261008000003_rls_functions.sql` (DB-003); §6 (storage) será materializado em `DB-004` e `admin_dashboard_metrics` em `DB-006`. Ajustes durante implementação devem atualizar este arquivo.

## 1. Convenções
- `snake_case`, tabelas no plural, PK `id uuid default gen_random_uuid()` (exceto tabelas de junção/progresso com PK composta).
- `created_at timestamptz not null default now()`, `updated_at` com trigger `public.set_updated_at()`.
- Dinheiro em **centavos** (`integer`), moeda `BRL`.
- Ordenação com `position integer not null`, `unique (parent_id, position) deferrable initially deferred` para permitir reordenação em transação.
- Enums Postgres para estados estáveis.
- RLS **habilitada em todas as tabelas** de `public`. Funções `SECURITY DEFINER` sempre com `set search_path = ''` e nomes qualificados.
- Índice em toda FK usada em filtro.

## 2. Diagrama

```text
auth.users
 └── profiles (1:1)                  nome, avatar, cpf/telefone (privados)
 └── user_roles (1:N, normalmente 1) role: admin | student
 └── enrollments (N) ───────────────▶ courses
 │     source: purchase | admin_grant, order_id?, revoked_at?
 └── orders (N) ────────────────────▶ courses
 │     status: pending|paid|failed|expired|refunded|canceled
 │     └── payment_events (N)        eventos brutos do provedor (dedupe)
 └── lesson_progress (N) ───────────▶ lessons

categories (1:N) ─▶ courses
courses
 └── course_modules (1:N, position)
      └── lessons (1:N, position, is_preview)
           └── lesson_materials (1:N, position, type)
```

## 3. Tabelas

### profiles
| coluna | tipo | notas |
|---|---|---|
| id | uuid PK → auth.users on delete cascade | |
| full_name | text not null default '' | |
| avatar_url | text | |
| tax_id | text | CPF só dígitos; preenchido no checkout |
| phone | text | |
| deleted_at | timestamptz | conta excluída pelo titular (DB-008); só `anonymize_user()` preenche |
| created_at / updated_at | timestamptz | |

Email **não** é duplicado (vem de `auth.users`; admin lê via view `admin_students` com security definer/service). Usuário só pode atualizar `full_name`, `avatar_url`, `tax_id`, `phone` (column-level `GRANT UPDATE`). Perfil com `deleted_at` não é editável (policy `profiles_update_own` exige `deleted_at is null`).

### user_roles
`user_id uuid → auth.users`, `role app_role ('admin','student')`, PK `(user_id, role)`. Sem INSERT/UPDATE/DELETE para `authenticated`. Admin concedido por script (`supabase/scripts/grant-admin.sql`) ou service role.

### categories
`id`, `slug unique`, `name`, `position`. Ex.: "Game Design", "Programação de Jogos", "Arte 2D". (Expansão futura: Web, Ferramentas.)

### courses
| coluna | tipo | notas |
|---|---|---|
| id | uuid PK | |
| slug | text unique not null | URL pública |
| title | text not null | |
| subtitle | text | linha curta do card |
| description | text not null default '' | markdown |
| cover_path | text | chave do objeto em `course-covers` (sem o nome do bucket) |
| category_id | uuid → categories on delete restrict | |
| level | course_level ('beginner','intermediate','advanced') not null default 'beginner' | |
| price_cents | integer not null default 0 check ≥ 0 | 0 = gratuito (ver nota) |
| status | course_status ('draft','published','archived') default 'draft' | |
| published_at | timestamptz | data da **primeira** publicação; mantida por trigger (valor enviado é ignorado) |
| estimated_minutes | integer | calculado ou manual |
| created_by | uuid → auth.users on delete set null | |

Contagem de aulas e duração total vêm da view `course_catalog` (somente cursos `published`).
Nota: cursos gratuitos estão **fora do MVP** (não antecipamos `source='free'`). Curso com `price_cents = 0` não pode ser publicado — validado na action de publicação **e** no banco (check `courses_published_requires_price`). Adicionar um valor ao enum depois é barato.

### course_modules
`id`, `course_id → courses on delete cascade`, `title`, `position`, timestamps. `unique(course_id, position) deferrable`.

### lessons
`id`, `module_id → course_modules on delete cascade`, `course_id → courses` (denormalizado para RLS/consultas; consistência garantida por trigger), `title`, `summary`, `position`, `duration_seconds int`, `is_preview bool default false`, timestamps.

### lesson_materials
| coluna | tipo | notas |
|---|---|---|
| id | uuid PK | |
| lesson_id | uuid → lessons on delete cascade | |
| course_id | uuid | denormalizado (trigger) |
| type | material_type ('video','text','file','link') | sem `pdf` (decisão do produto: não haverá PDFs; arquivos para download usam `file`). Expandir com `html_bundle`, `exercise` depois |
| title | text | |
| position | int | |
| body | text | markdown (type=text) |
| storage_path | text | chave no bucket `course-content`: `{course_id}/{lesson_id}/{uuid}-{nome}` (type=file) |
| file_name / file_size / mime_type | | |
| external_url | text | link |
| video_provider | text check in ('youtube','vimeo','bunny') | type=video |
| video_id | text | |
| show_in_all_lessons | bool not null default false | ADMIN-010: o player mostra o material em todas as aulas do curso (a aula de origem continua sendo `lesson_id`). **O acesso não muda**: a RLS da aula de origem decide (material de aula não-prévia não aparece para visitante em aula de prévia; de aula de prévia é público). Índice parcial `(course_id) where show_in_all_lessons` |
| check | | constraint por tipo: exige os campos do tipo **e proíbe os campos dos outros tipos** (ver §3.1) |

### enrollments
| coluna | tipo | notas |
|---|---|---|
| id | uuid PK | |
| user_id | uuid → auth.users on delete cascade | |
| course_id | uuid → courses on delete restrict | |
| source | enrollment_source ('purchase','admin_grant') | |
| order_id | uuid → orders | not null quando source='purchase', null em 'admin_grant' (check). FK composta `(order_id, user_id, course_id)` → pedido do mesmo usuário e curso |
| granted_by | uuid → auth.users | not null quando 'admin_grant', null em 'purchase' |
| granted_at | timestamptz default now() | |
| revoked_at / revoked_by / revoke_reason | | revogação lógica: os três juntos, **exceto** `revoke_reason = 'refund'` (revogação automática por reembolso, só em `purchase`), que aceita `revoked_by` nulo |
| created_at / updated_at | timestamptz | |
| unique parcial | `(user_id, course_id, source) where revoked_at is null` | |
| unique | `(order_id)` | um pedido gera no máximo uma matrícula |

### orders
| coluna | tipo | notas |
|---|---|---|
| id | uuid PK | enviado ao provedor como `externalId` |
| user_id | uuid → auth.users | |
| course_id | uuid → courses | |
| amount_cents | int not null | snapshot do preço |
| currency | text default 'BRL' | |
| status | order_status ('pending','paid','failed','expired','refunded','canceled') | |
| provider | text default 'abacatepay' | `abacatepay` (checkout) ou `manual` (venda manual) |
| provider_billing_id | text unique | id da cobrança (`pix_char_…`); nulo até a cobrança ser criada, depois imutável |
| pix_br_code | text | PIX copia-e-cola (Checkout Transparente, `docs/payments.md`); nulo até a cobrança |
| pix_br_code_base64 | text | imagem do QR; nulo até a cobrança |
| expires_at | timestamptz | expiração da cobrança PIX |
| paid_at | timestamptz | obrigatório se status ∈ (paid, refunded) |
| refund_requested_at | timestamptz | pedido de reembolso do aluno (até `paid_at + 7 dias`, validado na action); exige `paid_at` |
| refunded_at | timestamptz | obrigatório se status = refunded |
| source | order_source ('checkout','manual') default 'checkout' | venda manual registrada pelo admin |
| created_by | uuid → auth.users | obrigatório se manual, nulo se checkout |
| created_at / updated_at | timestamptz | |
| índice parcial | `(user_id, course_id) where status='pending'` unique | evita pedidos pendentes duplicados |

Sem `checkout_url`: usamos o Checkout Transparente PIX (QR na nossa página). Disputas (`transparent.disputed`) **não** mudam `order_status` — ficam só em `payment_events`; disputa perdida (`transparent.lost`) vira `refunded`. `user_id`/`course_id` são `on delete restrict` (registro financeiro: comprador e curso vendido não podem ser apagados — exclusão de conta é por anonimização: `anonymize_user()` + soft delete no Auth, ver §4.1).

### payment_events
`id`, `provider`, `provider_event_id text not null unique`, `event_type`, `order_id → orders null (on delete restrict)`, `payload jsonb`, `received_at`, `processed_at`, `processing_error`. Apenas service role escreve; admin lê.

### lesson_progress
PK `(user_id, lesson_id)`; `course_id` (denormalizado por trigger + FK composta para `lessons(id, course_id)`); `completed_at timestamptz null`; `last_position_seconds int not null default 0 (≥ 0)`; `created_at`; `updated_at`. Índice `(user_id, course_id, updated_at desc)`.

### 3.1 Regras de integridade implementadas (DB-001/DB-002)
- **RLS habilitada** em todas as tabelas e `revoke all ... from anon, authenticated`: até o DB-003 nada é acessível pelo client (service role mantém acesso).
- **`course_id` denormalizado** (`lessons`, `lesson_materials`, `lesson_progress`): trigger `BEFORE INSERT/UPDATE` copia do pai (valor enviado é ignorado) **e** FK composta `(parent_id, course_id) → parent(id, course_id) on update cascade` — se um módulo/aula mudar de curso, tudo abaixo acompanha. Funções de trigger são `security definer` com `search_path = ''` (não dependem das policies de SELECT do chamador e não são chamáveis via RPC).
- **`lesson_materials` por tipo**: `video` exige `video_provider`+`video_id`; `text` exige `body` não vazio; `file` exige `storage_path` (único tipo com `file_name/file_size/mime_type`); `link` exige `external_url`. Campos de outros tipos devem ser nulos (ao trocar o tipo, a action limpa os campos antigos).
- **Formatos defensivos**: `video_id` só `[A-Za-z0-9_-]` (com no máximo um `/`, ex.: Vimeo `id/hash`) — sem injeção na URL do embed; `external_url` só `http(s)://`; `avatar_url` só `https://`; `storage_path`/`cover_path` relativos ao bucket, sem `/` inicial, `..`, backslash ou caracteres de controle; `tax_id` 11 dígitos; `phone` 10–15 dígitos; slugs `^[a-z0-9]+(-[a-z0-9]+)*$` (≤ 100); títulos não vazios (≤ 200).
- **Posições** `≥ 0` e `unique (parent, position) deferrable initially deferred` (também em `categories.position`).
- **`orders`** (trigger `orders_guard_immutable`): `user_id`, `course_id`, `amount_cents`, `currency`, `source`, `provider`, `created_by` são imutáveis; `provider_billing_id` só pode ir de nulo para um valor. `currency = 'BRL'`, `amount_cents > 0`.
- **`enrollments`** (trigger `enrollments_guard`): nasce ativa; `purchase` só com pedido `paid` (então `fulfill_order` marca o pedido como pago **antes** de inserir a matrícula); a única alteração permitida é revogar; matrícula revogada é definitiva (novo acesso = nova linha, histórico preservado).
## 4. Funções
Implementadas em `supabase/migrations/20261008000003_rls_functions.sql` (DB-003). Todas as `SECURITY DEFINER` têm `set search_path = ''`; toda função tem `revoke all ... from public, anon, authenticated` seguido de grants explícitos.

| função | tipo | quem executa | uso |
|---|---|---|---|
| `is_admin()` | stable, security definer | authenticated, service_role | policies, guards; lê `user_roles` (nunca metadata) |
| `has_course_access(p_course_id)` | stable, security definer | anon (sempre `false`), authenticated, service_role | admin → true; aluno → matrícula ativa **e** curso `published`/`archived` (rascunho nunca, mesmo com `admin_grant`) |
| `handle_new_user()` | trigger security definer em `auth.users` | — | cria `profiles` (só `full_name`/`name` do metadata, sem caracteres de controle, espaços colapsados, ≤ 120) + `user_roles('student')`; **ignora metadata.role** |
| `fulfill_order(p_order_id, p_provider_billing_id, p_amount_cents, p_event_id)` | security definer | **só service_role** | `select … for update` no pedido; aceita `pending`/`expired`/`failed` → `paid` (+`paid_at`; `failed` desde a migration `20261009000007` — cobrança paga após timeout no PAY-002; `canceled`/`refunded` → `invalid_status`); valida valor e cobrança; cria `enrollment(purchase)` (`on conflict` na matrícula ativa); marca `payment_events`. Retorna `fulfilled` · `paid_already_enrolled` (pagamento em duplicidade: reembolsar) · `already_paid` · `order_not_found` · `invalid_status` · `amount_mismatch` · `billing_mismatch` |
| `refund_order(p_order_id, p_event_id)` | security definer | **só service_role** | reembolso confirmado / disputa perdida: `paid` → `refunded` (+`refunded_at`) e revoga a matrícula do pedido (`revoke_reason='refund'`, `revoked_by` nulo). Retorna `refunded` · `already_refunded` · `order_not_found` · `invalid_status` |
| `request_refund(p_order_id)` | security definer | authenticated | aluno pede reembolso do **próprio** pedido `checkout` pago em até `paid_at + 7 dias`; grava `refund_requested_at` e `refund_requested_progress` (% de aulas concluídas). Antiabuso: recusa se o mesmo usuário já reembolsou (ou pediu) o mesmo curso em outro pedido. Retorna `requested` · `already_requested` · `already_refunded` · `not_found` · `not_paid` · `not_eligible` (venda manual) · `window_expired` · `previously_refunded` |
| `admin_record_manual_sale(p_user_id, p_course_id, p_amount_cents default preço)` | security definer + `is_admin()` | authenticated | cria `orders(manual, paid)` + `enrollment(purchase)` atomicamente. Exceções: `42501`, `P0002` curso inexistente, `22023` não publicado/valor inválido, `23505` já tem compra ativa |
| `admin_students(p_search, p_limit, p_offset)` | stable, security definer + `is_admin()` | authenticated | substitui a view `admin_students` (não expõe `auth.users`): perfil + email + `is_admin` + matrículas ativas + total gasto (`paid`) + último pedido + `total_count`. Busca literal (sem curingas) em email/nome; `limit` 1–200 |
| `admin_student_by_id(p_user_id)` | stable, security definer + `is_admin()` | authenticated | uma linha de `admin_students` (sem `total_count`) para o perfil do aluno; 0 linhas se o id não existe; 42501 para não-admin |
| `anonymize_user(p_user_id)` | security definer | **só service_role** | **DB-008.** Exclusão de conta pelo titular (action `deleteMyAccount`). Ver §4.1. Retorna `anonymized` · `already_anonymized` · `not_found` · `is_admin` · `refund_pending` · `payment_pending` |
| `reorder_modules(p_course_id, ids[])` / `reorder_lessons(p_module_id, ids[])` / `reorder_materials(p_lesson_id, ids[])` | security invoker + `is_admin()` | authenticated | recebe a lista **completa** na nova ordem (positions `0..n-1`); `22023` se faltar/repetir/for de outro pai |
| `admin_dashboard_metrics(p_from, p_to)` | stable, security definer + `is_admin()` | authenticated | **DB-006.** Uma linha de KPIs do período `[p_from, p_to)`: `revenue_cents` (vendas − estornos), `sales_count`, `avg_ticket_cents` (vendas brutas ÷ nº de vendas; 0 sem vendas), `students_total`/`students_new` (perfis sem papel admin), `enrollments_purchase`/`enrollments_admin_grant` (concedidas no período e ainda ativas), `refunds_count`, `pending_refund_requests` (fila atual: `paid` com `refund_requested_at`, independe do período) |
| `admin_revenue_by_day(p_from, p_to)` | stable, security definer + `is_admin()` | authenticated | **DB-006.** `(day date, revenue_cents bigint, sales int)` por dia em `America/Sao_Paulo`, dias sem venda = 0 (`generate_series`); receita líquida do dia (pode ser negativa); soma dos dias = `revenue_cents` das métricas |
| `admin_top_courses(p_from, p_to, p_limit default 5)` | stable, security definer + `is_admin()` | authenticated | **DB-006.** `(course_id, slug, title, sales, revenue_cents)` ordenado por receita líquida; `p_limit` limitado a 1–50 |

**Métricas (DB-006).** *Venda* = pedido `paid` ou `refunded` com `paid_at` no período (inclui venda manual); *estorno* = pedido `refunded` com `refunded_at` no período. Intervalo `p_to` exclusivo; `p_to > p_from` e no máximo 366 dias, senão `22023`; não-admin `42501`. Helper interno `admin_metrics_check_range` (sem grants). Índices: `orders_paid_at_idx` (existente) e `orders_refunded_at_idx` (novo). Migration `20261009000005_admin_metrics.sql`; teste `supabase/tests/08_admin_metrics.test.sql`.

### 4.1 Exclusão de conta (DB-008, LGPD)
`orders.user_id` é `on delete restrict`, então a linha de `auth.users` de quem comprou **não pode** ser apagada (hard delete). Fluxo da Server Action `deleteMyAccount` (`src/features/account/actions.ts` + `deletion.ts`, service role):
1. Guard (`userAction`) → o usuário digita o próprio e-mail (comparado com o da sessão) → admin recusado (`user_roles`).
2. `anonymize_user(uid)`: trava perfil e pedidos (`for update`); recusa `is_admin`, `refund_pending` (pedido `paid` com `refund_requested_at` e sem `refunded_at`) e `payment_pending` (pedido `pending` com cobrança criada e `expires_at` no futuro ou nulo). Senão: `profiles.full_name = 'Conta excluída'`, `tax_id`/`phone`/`avatar_url` nulos, `deleted_at` (mantém o original na repetição); revoga matrículas ativas (`revoked_by` = o titular, `revoke_reason = 'account_deleted'`); apaga `lesson_progress`. **Não** toca `orders`/`payment_events`/`user_roles`. Idempotente.
3. Auth Admin: remove cada chave de `user_metadata` (o GoTrue faz merge; chave `null` = remover), `ban_duration = 876000h` e `deleteUser(id, true)` (soft delete: `auth.users.deleted_at`, email/telefone ofuscados, senha, identidades, MFA e sessões removidos; a linha fica como chave pseudônima de `orders`/`enrollments`).
4. `signOut({ scope: 'local' })` (cookies) → toast e volta para `/`.
Se o passo 3 falhar, o usuário continua logado e pode repetir (o passo 2 devolve `already_anonymized`). Migration `20261009000009_account_deletion.sql`; teste `supabase/tests/11_account_deletion.test.sql`.

Erros de regra de negócio nas funções chamadas pelo app (`request_refund`, `fulfill_order`, `refund_order`) são **códigos de resultado** (text), não exceções — a action/webhook mapeia para pt-BR e `fulfill_order`/`refund_order` gravam `payment_events.processing_error`.

Ajustes de schema no DB-003: `lesson_progress.user_id default auth.uid()`; `orders.refund_requested_progress smallint` (0–100, exige `refund_requested_at`).

## 5. Views
Todas `security_invoker = true` (a RLS de quem consulta se aplica). Grants: `course_catalog`/`course_outline` → anon e authenticated; `my_library` → authenticated.
- `course_catalog`: cursos `published` (filtro explícito, inclusive para admin) + categoria (`category_slug/name/position`) + `module_count`, `lesson_count`, `total_duration_seconds`.
- `course_outline`: uma linha por aula (`course_id`, `module_*`, `lesson_*`, `duration_seconds`, `is_preview`), sem conteúdo. **Sem filtro de status**: a RLS decide (anon/sem acesso → publicados; com acesso → também arquivados; admin → todos), para o player de curso arquivado reutilizá-la.
- `my_library`: uma linha por curso com matrícula ativa do `auth.uid()` (mesmo para admin): `sources` (`{purchase,admin_grant}`), `has_purchase`, `has_admin_grant`, `first_granted_at`, `lesson_count`, `completed_count`, `progress_percent`, `is_completed`, `last_accessed_at`, `last_lesson_id` (“continuar”). Curso em rascunho não aparece.
- `admin_students`: **virou função** (ver §4).

## 6. Storage
Implementado em `supabase/migrations/20261008000004_storage.sql` (DB-004); testes em `supabase/tests/07_storage.test.sql`.

| bucket | público | limite | tipos aceitos | leitura | escrita |
|---|---|---|---|---|---|
| `course-covers` | sim | 5 MB | `image/jpeg`, `image/png`, `image/webp`, `image/avif` | todos, pela URL pública do bucket (não passa por RLS; sem policy de SELECT, então a API não **lista** o bucket) | admin |
| `course-content` | não | 200 MB | lista explícita: zip/7z/rar/tar/gzip, `application/octet-stream` (assets de engine/arte), json/txt/md/csv, imagens raster, áudio, vídeo mp4/webm, fontes, glTF/obj | **ninguém via client** (nem aluno com acesso) — signed URL gerada no servidor | admin |
| `avatars` | sim | — | — | todos | dono (pasta `{user_id}/`) — pós-MVP |

- **Sem conteúdo ativo**: nenhum bucket aceita `text/html`, `image/svg+xml` nem JavaScript (o Storage serve o objeto com o `content-type` do upload; HTML/SVG na origem do Storage seria XSS — audit S5). O Supabase só aceita lista de permitidos, então os tipos são listados um a um, **sem curingas** (`image/*`, `text/*` incluiriam svg/html).
- **Policies** em `storage.objects`, todas `to authenticated` e `(select public.is_admin())`: `course_storage_{select,insert,update,delete}_admin`, restritas aos dois buckets. O admin precisa de SELECT para `upsert` e para o painel. **Não há policy para `anon`** (uma policy de SELECT só acrescentaria listagem de capas de cursos em rascunho) **nem SELECT de `course-content` para aluno**.
- **Download**: `getMaterialDownloadUrl(materialId)` (`src/features/materials/storage.ts`) lê o material com o client do usuário (a RLS de `lesson_materials` decide: preview, matrícula ativa ou admin) e só então usa o service client para `createSignedUrl` (≤ 600 s, `download: file_name`). Material inexistente e material sem acesso voltam como o mesmo erro `not_found`. Quem entrega a URL ao navegador responde com `Cache-Control: private, no-store`.
- **Capas**: `getCoverPublicUrl(path)` monta a URL pública sem consultar o banco.
- **Caminho dos arquivos**: `{course_id}/{lesson_id}/{uuid}-{nome}`; `lesson_materials.storage_path` é validado no banco (sem `..` nem caminho absoluto).
- **Limite do plano**: o Supabase também tem um limite global de upload por projeto (plano Free: 50 MB); o de 200 MB do bucket só vale se o plano/`file_size_limit` global permitir.
- **Testes locais**: `storage.objects` tem o trigger `storage.protect_delete`; testes que fazem `DELETE` direto precisam de `set local storage.allow_delete_query = 'true'` (o que o próprio Storage API faz).

## 7. Migração de dados do projeto antigo
Ver `REL-002` (só se houver dados reais). Mapeamento: `user_courses` (assigned_by null) → `enrollments(purchase)` com `orders(manual)` sintético; `assigned_by` não nulo → `admin_grant`; `sales` → `orders(status='paid')`.
