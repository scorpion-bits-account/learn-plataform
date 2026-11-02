# Registro de decisões (ADR leve)

Formato: **ID — título** · status · data. Contexto → decisão → consequências.
Status: `aceita`, `proposta` (aguardando validação do responsável do produto), `substituída por ADR-xxx`.

---

### ADR-001 — Reconstruir neste repo, portando seletivamente do Learn antigo
`aceita` · 2026-10-08
- **Contexto**: o repo novo está vazio; o antigo tem falhas críticas de segurança (ver `docs/audit.md` §2.1), drift de schema e visual abaixo do desejado.
- **Decisão**: não copiar o projeto antigo inteiro. Criar fundação limpa aqui e portar trechos aprovados (clients Supabase, validações, ideias do player).
- **Consequências**: mais trabalho inicial na fundação; elimina dívida de segurança na origem.

### ADR-002 — Next.js 16 (App Router) + TypeScript
`aceita` (produto confirmou em 2026-10-08) · 2026-10-08
- **Contexto**: o antigo usa Next 16 em JS. Como estamos recomeçando, o custo de TS é baixo e os tipos gerados do Supabase (`supabase gen types`) evitam erros de coluna/RLS em toda a base.
- **Decisão**: Next.js 16 App Router, React 19, **TypeScript strict**. Server Components por padrão; Server Actions para mutações; Route Handlers só para webhooks/arquivos.
- **Consequências**: agentes devem ler `node_modules/next/dist/docs/` (Next 16 tem breaking changes — ex.: `middleware` → `proxy.ts`, `params` assíncronos).

### ADR-003 — Estilo: CSS Modules + tokens em CSS custom properties (sem Tailwind, sem UI kit)
`aceita` · 2026-10-08
- **Contexto**: a identidade Scorpion Bits é artesanal (clip-paths, malha isométrica, chanfros). Um kit (shadcn/MUI) puxaria para o visual genérico que queremos evitar; o site da marca já é CSS puro.
- **Decisão**: `src/styles/tokens.css` (variáveis), `src/styles/base.css` (reset/tipografia) e CSS Modules por componente. Nenhuma lib de UI. Primitivas acessíveis escritas à mão; `<dialog>` nativo para modais.
- **Consequências**: proibido criar `globals.css` monolítico. Toda cor/espaço/raio vem de token.

### ADR-004 — Produto único no MVP: **Curso**
`aceita` · 2026-10-08
- **Decisão**: só `courses` são vendáveis. E-books, materiais avulsos e playlists saem. (PDFs também não existem — ADR-020.)
- **Consequências**: modelo de pedido/acesso simples (FK real para `courses`). Expansão futura (trilhas, bundles) entra como nova tabela `products` se e quando necessário.

### ADR-005 — Papéis em tabela própria, nunca editáveis pelo usuário nem vindos de metadata
`aceita` · 2026-10-08
- **Decisão**: `public.user_roles (user_id, role app_role)`; sem policies de escrita para `authenticated`; papel admin concedido apenas via SQL/service role (script de bootstrap). Checagem em SQL por `public.is_admin()` (`SECURITY DEFINER`, `search_path = ''`). O trigger de cadastro **ignora** `raw_user_meta_data.role`.
- **Consequências**: corrige S1/S2 do audit. Frontend nunca decide autorização.

### ADR-006 — Acesso a curso = tabela `enrollments` com **origem** e **revogação lógica**
`aceita` · 2026-10-08
- **Contexto**: precisamos distinguir comprado vs. atribuído e não perder histórico.
- **Decisão**: `enrollments` (um registro por concessão): `source in ('purchase','admin_grant')`, `order_id` (obrigatório se purchase), `granted_by`, `revoked_at/revoked_by/revoke_reason`. Acesso efetivo = existe concessão não revogada (`public.has_course_access(course_id)`). Índice único parcial `(user_id, course_id, source) where revoked_at is null`.
- **Consequências**: admin remover uma atribuição não apaga uma compra; o aluno pode ter as duas origens. A biblioteca mostra o selo "Comprado"/"Atribuído".

### ADR-007 — Progresso no banco
`aceita` · 2026-10-08
- **Decisão**: `lesson_progress (user_id, lesson_id, course_id, completed_at, last_position_seconds, updated_at)`. "Continuar de onde parou" = linha com `updated_at` mais recente do curso.
- **Consequências**: substitui `localStorage`; UI usa optimistic update com rollback.

### ADR-008 — Pagamentos: pedido no nosso banco é a fonte da verdade; acesso só via webhook verificado
`aceita` · 2026-10-08
- **Decisão**: `orders` (preço em centavos congelado na criação) + `payment_events` (dedupe por id do evento). Webhook: valida segredo + assinatura HMAC → grava evento → **reconsulta o status na API do AbacatePay** (ou valida o payload assinado) → chama `public.fulfill_order(order_id, …)` (função SQL atômica e idempotente que confere valor e cria `enrollment`). Página de retorno **nunca** concede acesso: só exibe estado do pedido (polling).
- **Consequências**: corrige S6/S7/S8. Versão exata da API (v1 vs v2) a confirmar em `PAY-001`.

### ADR-009 — Conteúdo protegido via Storage privado + URLs assinadas curtas geradas no servidor
`aceita` · 2026-10-08
- **Decisão**: buckets `course-covers` (público) e `course-content` (privado). Servidor checa `has_course_access` e emite signed URL (≤ 10 min), `Cache-Control: private, no-store` em respostas que dependam de sessão.
- **Consequências**: corrige S4.

### ADR-010 — HTML interativo (slides) fora do escopo; se um dia entrar, origem isolada
`aceita` (produto: "pode esquecer") · 2026-10-08
- **Decisão**: material tipo `html_bundle` fica no backlog pós-MVP (`STUDENT-010`). Implementação futura em iframe `sandbox` sem `allow-same-origin` servido de domínio separado.
- **Consequências**: corrige S5 por omissão. **Validar com o produto** se slides HTML são essenciais no lançamento.

### ADR-011 — Vídeo no MVP: embed de provedor externo (YouTube não listado / Vimeo / Bunny)
`aceita` (produto aceitou o risco de vazamento de link) · 2026-10-08
- **Contexto**: hospedagem de vídeo própria é cara e complexa. YouTube não listado **não é proteção real** (link vaza).
- **Decisão**: material `video` guarda `provider` + `external_id`; o player monta o embed. Só é entregue ao cliente se `has_course_access` (ou aula preview). Migração futura para Bunny Stream / Mux com URLs assinadas.
- **Consequências**: risco de compartilhamento de link aceito para o MVP — **validar com o produto**.

### ADR-012 — Catálogo e página de curso públicos
`aceita` · 2026-10-08
- **Decisão**: `/cursos` e `/cursos/[slug]` acessíveis sem login (SEO e conversão). Ementa (módulos/aulas: títulos e duração) é pública para cursos publicados; conteúdo das aulas não.

### ADR-013 — Sem bibliotecas extras sem justificativa
`aceita` · 2026-10-08
- Permitidas no MVP: `@supabase/ssr`, `@supabase/supabase-js`, `zod` (validação de input em Server Actions/rotas), `server-only`, dev: `vitest`, `@playwright/test`, `supabase` CLI, `prettier`. Markdown de aula: `react-markdown` + `rehype-sanitize` (quando `STUDENT-006`). Qualquer outra exige ADR.

### ADR-014 — Idioma e nomenclatura
`aceita` · 2026-10-08
- UI e documentação em **pt-BR**. Código, nomes de tabelas, colunas e rotas internas em **inglês**; URLs públicas em pt-BR (`/cursos`, `/entrar`, `/minha-biblioteca`).

### ADR-015 — Ambiente: Supabase novo, sem migração de dados, domínio Vercel padrão
`aceita` · 2026-10-08
- **Contexto**: o Learn antigo não tem usuários nem vendas reais.
- **Decisão**: criar um **projeto Supabase novo**; **não** haverá migração de dados (REL-002 cancelada); usar o domínio padrão `*.vercel.app` até haver domínio próprio.
- **Consequências**: `NEXT_PUBLIC_SITE_URL` aponta para a URL Vercel; trocar quando houver domínio (callbacks do Supabase Auth e URL do webhook precisam ser atualizados juntos).

### ADR-016 — Pagamento apenas PIX via AbacatePay no MVP; avaliar Cakto
`aceita` · 2026-10-08
- **Decisão**: MVP só com PIX pelo AbacatePay. `PAY-001` inclui um estudo comparativo **AbacatePay × Cakto** (taxas, métodos, API/webhooks, repasse, área de membros própria vs. integração). Troca só com nova ADR.
- **Consequências**: código de pagamento isolado em `src/lib/payments/` com interface pequena (`createCheckout`, `getPaymentStatus`, `verifyWebhook`) para que uma troca de provedor fique contida — sem criar abstração multi-provedor antecipada.

### ADR-017 — Reembolso revoga o acesso automaticamente
`aceita` · 2026-10-08
- **Decisão**: seguir o CDC (art. 49): o aluno pode pedir reembolso **a qualquer momento dentro de 7 dias** da compra, sem precisar justificar. Quando o reembolso é confirmado pelo provedor (evento de reembolso), `orders.status='refunded'` e a matrícula `purchase` daquele pedido é revogada automaticamente (`revoke_reason='refund'`). Depois de 7 dias, reembolso só por decisão manual do admin.
- **Descartado**: a regra de "10 minutos" proposta inicialmente (produto optou por seguir o CDC).
- **Regra estilo Steam ("só se viu menos de X% do curso")**: **não pode limitar os 7 dias legais** — o CDC/Decreto 7.962/2013 não preveem exceção por consumo de conteúdo digital e uma cláusula assim tende a ser considerada abusiva (art. 51). O que fazemos: (1) registrar o % do curso consumido no momento do pedido de reembolso, visível ao admin; (2) antiabuso: quem já reembolsou um curso não pode reembolsá-lo de novo após recomprar; (3) termos de uso explicando a política. Opcional futuro: janela **extra** e voluntária além dos 7 dias condicionada a consumo (ex.: até 30 dias se < 20% assistido). Validar com advogado antes do lançamento.
- **Consequências**: PAY-003 trata o evento de reembolso; a interface de pedido do aluno mostra até quando o reembolso pode ser pedido (pedido feito pelo canal de suporte/admin no MVP, a menos que PAY-001 mostre reembolso simples via API).

### ADR-018 — Checkout Transparente PIX (API v2) em vez de checkout hospedado
`aceita` · 2026-10-08 (resultado do PAY-001)
- **Contexto**: o checkout hospedado da AbacatePay v2 exige produtos cadastrados no provedor (preço fora do nosso banco, sem API de atualização). O transparente aceita `amount` por cobrança e devolve o QR PIX.
- **Decisão**: `POST /v2/transparents/create` com `amount = orders.amount_cents` e `externalId = order.id`; o aluno paga pelo QR exibido em `/checkout/pedido/[id]`. Pedido resolvido por `externalId` no webhook.
- **Segurança**: a assinatura `X-Webhook-Signature` usa chave **pública** (só integridade); a origem é provada apenas pelo `webhookSecret` da URL → reconsulta `GET /v2/transparents/check` é **obrigatória** antes de liberar acesso; a URL do webhook nunca é logada.
- **Consequências**: `orders.checkout_url` substituída por `pix_br_code`/`pix_br_code_base64`; `ABACATEPAY_WEBHOOK_HMAC_KEY` deixa de ser env; disputas (`transparent.disputed/lost`) só registram e alertam o admin (sem novo status). Produção exige CNPJ e site com termos/privacidade/CNPJ no rodapé (STUDENT-008). Cakto reavaliada se houver cartão/afiliados (ver `docs/payments.md` §9).

### ADR-019 — Celular é plataforma de primeira classe (mobile-first + PWA instalável)
`aceita` · 2026-10-08 (pedido do produto: "total portabilidade para uso pelo celular")
- **Decisão**: todas as telas (aluno **e admin**) são projetadas primeiro para 360–430px e testadas em celular real/emulado. A plataforma é um **PWA instalável** (manifest, ícones, tela cheia, `theme-color`), sem app nativo. Player com controles na zona do polegar (barra inferior fixa), ementa em bottom-sheet, sem hover como única forma de interação, alvos ≥ 44px, `100dvh`/safe-area (`env(safe-area-inset-*)`).
- **Fora do MVP**: modo offline/download de aulas, push notifications, app nas lojas.
- **Consequências**: UI-006 (manifest/ícones) sobe para P1; cada tarefa de tela tem critério "funciona completo em 360px com toque"; QA inclui testes Playwright com perfis de celular (iPhone/Android).

### ADR-020 — Sem PDFs na plataforma
`aceita` · 2026-10-08 (decisão do produto)
- **Decisão**: o tipo de material `pdf` sai do modelo. Materiais de aula: `video`, `text` (markdown), `file` (arquivos para download — assets, projetos `.zip` etc.) e `link`.
- **Consequências**: sem visualizador de PDF no player; `ADMIN-004` e `STUDENT-006` sem PDF.

### ADR-021 — Playwright (`@playwright/test`) para E2E, com Supabase local e mock da AbacatePay
`aceita` · 2026-10-09 (QA-001/QA-003)
- **Contexto**: testes unitários e pgTAP não pegam bugs que só aparecem com o app, o banco e o storage reais juntos (ex.: embed `lessons(count)` sem FK, rota `/conta` inexistente). ADR-019 já previa Playwright com perfis de celular.
- **Decisão**: adotar `@playwright/test` (devDependency, versão fixa `1.56.1`, a mesma do Playwright global do ambiente dos agentes e do Chromium em `/opt/pw-browsers`) para os fluxos críticos. Suíte em `e2e/` (`*.spec.ts`), `npm run test:e2e`, projects `desktop-chrome`, `pixel-7` e `iphone-14`. O iPhone 14 roda em **Chromium com viewport, user agent e toque do aparelho**, para o CI baixar só um navegador; `E2E_IPHONE_WEBKIT=1` troca para o WebKit real (precisa de `npx playwright install webkit`). Os testes rodam contra `supabase start` (Auth, Postgres, Storage, Mailpit), nunca contra um projeto remoto (`e2e/support/env.ts` recusa URL que não seja loopback).
- **Pagamento**: servidor HTTP mínimo em `e2e/mocks/abacatepay.ts` (`create`, `check`, `refund`, `simulate-payment`), coberto por Vitest, que o app acessa pela env `ABACATEPAY_API_BASE_URL` (validada com zod em `src/lib/payments/api-base-url.ts`: só `https://…` ou `http://localhost|127.0.0.1`; padrão = URL real; recusada com chave `abc_prod_`). O webhook testado é o real do app (`/api/webhooks/abacatepay`), com segredo na URL e HMAC; o "pago" continua exigindo a reconsulta ao mock (ADR-008/ADR-018).
- **CI**: job `e2e` depois de `ci`; liga a confirmação de email e sobe o limite de emails só na cópia efêmera do `supabase/config.toml`; relatório e traces como artifact em falha; 1 retry. Falha nunca é escondida com `test.skip`.
- **Consequências**: +1 devDependency e ~2 min de download de navegador no CI; testes de UI dependem dos textos pt-BR (mudar um rótulo exige ajustar o teste); dados de teste são únicos por execução (sem limpeza: o banco local é descartável).

### ADR-022 — Cartão via checkout hospedado da AbacatePay (com produto espelho por curso e preço)
`aceita` · 2026-11-02 (PAY-007; spike em `docs/payments.md` §10)
- **Contexto**: a conta de produção liberou cartão no checkout. A v2 agora documenta dois caminhos: o checkout hospedado (`/v2/checkouts/*`), que só cobra **produtos cadastrados**, e o cartão no checkout transparente (`method: "CARD"`), com valor livre mas tokenização pelo `abacatepay.js` (script de terceiro na nossa página, chave pública `pk_…`, liberação `CARD_TRANSPARENTS` à parte, `externalId` ignorado).
- **Decisão**: cartão pelo **checkout hospedado** com `methods: ["CARD"]` (PIX continua no transparente, ADR-018). O preço continua congelado em `orders.amount_cents`: o servidor espelha um produto avulso por (curso, preço) com `externalId = course-<courseId>-<amountCents>` (`products/get` → 404 → `products/create`), cria o checkout com `externalId = orders.id`, confere `amount`/`externalId`/host da `url` antes do `redirect` e grava `provider_billing_id = bill_…` e `checkout_url`. Webhook `checkout.*` com a mesma verificação (segredo + HMAC) e **reconsulta obrigatória** `GET /v2/checkouts/get` (status `PAID` + valores) antes de `fulfill_order`; reembolso pelo admin com `POST /v2/checkouts/refund`; `checkout.lost` revoga via `refund_order`, `checkout.disputed` só alerta.
- **Por quê**: dados de cartão nunca tocam o nosso servidor nem a nossa página (PCI fica com a AbacatePay); sem script de terceiro/CSP/nova dependência; mesmo modelo de correlação (`externalId`) e de webhook do PIX; não depende de liberação extra na conta. Custo aceito: produto espelho na AbacatePay e o aluno sai do site para pagar.
- **Parcelamento**: até `CARD_MAX_INSTALLMENTS` (12), limitado a parcelas ≥ R$ 10,00; taxa por conta da loja (sem `passFeesToCustomer`). Repassar juros ao aluno é decisão do produto (exige ajustar a checagem de valor).
- **Consequências**: migration `20261102000012_card_payments.sql` (`orders.payment_method` `pix|card`, `orders.checkout_url`); chave de API precisa de `CHECKOUT:CREATE`, `CHECKOUT:READ`, `PRODUCT:CREATE`, `PRODUCT:READ` além das do PIX (nova chave: permissões não são editáveis); webhook precisa assinar também `checkout.completed|refunded|disputed|lost`. Revisitar o transparente com `abacatepay.js` se o produto exigir pagamento sem sair do site (nova ADR para o script).
