# Colocar a plataforma no ar (Supabase + Vercel + AbacatePay)

Guia passo a passo para o responsável do projeto. Leva ~30 min. Nenhuma chave secreta deve ser colada em chat, issue ou commit.

## 1. Supabase — criar o banco

1. Crie um projeto novo em https://supabase.com/dashboard (região: São Paulo `sa-east-1`). Guarde a senha do banco.
2. Crie as tabelas aplicando as migrations **em ordem**. Escolha uma opção:

   **Opção A — pelo navegador (mais simples):** abra *SQL Editor → New query*, cole o conteúdo de cada arquivo abaixo, clique *Run*, e só então passe para o próximo:
   1. `supabase/migrations/20261008000001_core_schema.sql`
   2. `supabase/migrations/20261008000002_access_commerce.sql`
   3. `supabase/migrations/20261008000003_rls_functions.sql`
   4. `supabase/migrations/20261008000004_storage.sql`
   5. `supabase/migrations/20261009000005_admin_metrics.sql`
   6. `supabase/migrations/20261009000006_admin_student_by_id.sql`
   7. `supabase/migrations/20261009000007_fulfill_failed_orders.sql`
   8. `supabase/migrations/20261009000008_lessons_course_fkey.sql`
   9. `supabase/migrations/20261009000009_account_deletion.sql`
   10. `supabase/migrations/20261009000010_course_students.sql`
   11. `supabase/migrations/20261102000011_course_wide_materials.sql`

   > Sempre que surgir um arquivo novo nessa pasta, rode **só ele** (os anteriores já estão aplicados). Use o botão *Copy raw file* do GitHub para não truncar a colagem.

   **Opção B — pelo terminal (recomendado para atualizações futuras):**
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-do-projeto>   # o ref está na URL do dashboard
   npx supabase db push                                # aplica todas as migrations pendentes
   ```
   > Não rode `supabase/seed.sql` no projeto real: ele cria usuários de teste.

3. Confira em *Database → Advisors → Security*: não deve haver alertas de segurança.
4. **Auth → URL Configuration**
   - *Site URL*: a URL da Vercel (passo 2), ex. `https://learn-plataform.vercel.app`
   - *Redirect URLs*: `https://<sua-url>.vercel.app/auth/callback`, `https://*-<seu-time>.vercel.app/auth/callback` (previews) e `http://localhost:3000/auth/callback`
5. **Auth → Providers → Email**: senha mínima 8; "Confirm email" ligado.
6. **Auth → Email Templates** (pt-BR). Use **`token_hash`** no link, e **não** `{{ .ConfirmationURL }}`: o link padrão é PKCE e só funciona no mesmo navegador que pediu o email (pedir no computador e abrir no celular dá "link inválido"). O `/auth/callback` aceita os dois formatos.
   - *Confirm signup*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/inicio`
   - *Reset password*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha`
   - O *Site URL* (item 4) precisa ser o domínio de produção (`https://learn.scorpionbits.com`).
   - **SMTP próprio** (*Auth → Emails → SMTP Settings*): Resend (`smtp.resend.com`, porta 465, usuário `resend`, senha = API key com *Sending access*), remetente `nao-responda@scorpionbits.com` com o domínio verificado na Resend. Suba o *Rate limit* de emails (*Auth → Rate Limits*) para ~100/h.
7. **Project Settings → API Keys**: copie a *Project URL*, a *Publishable key* e a *Secret key* (esta é secreta).

### Criar o primeiro admin
1. Cadastre-se normalmente na plataforma (vira aluno).
2. No *SQL Editor* rode (troque o email):
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where lower(email) = lower('seu@email.com')
   on conflict do nothing;
   ```
3. Saia e entre de novo: `/admin` passa a abrir.

## 2. Vercel — publicar

1. https://vercel.com/new → importe `scorpion-bits/learn-plataform`. Framework: Next.js (detecta sozinho).
2. **Environment Variables** (Production e Preview):

   | Nome | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL do Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key (**secreta**) |
   | `NEXT_PUBLIC_SITE_URL` | a URL final da Vercel |
   | `ABACATEPAY_API_KEY` | chave **Dev** (`abc_dev_…`) por enquanto (**secreta**) |
   | ~~`ABACATEPAY_API_BASE_URL`~~ | **não configure** — existe só para os testes E2E (mock) |
   | `ABACATEPAY_WEBHOOK_SECRET` | uma string aleatória longa que você inventa (ex. gerada por um gerenciador de senhas) (**secreta**) |

3. Enquanto o código está na branch `claude/exciting-ramanujan-xhdzfd`, a Vercel gera um **Preview** dela (aba *Deployments*). A produção sai quando a branch for mesclada na `main`.
4. Depois do primeiro deploy, volte ao Supabase (passo 1.4) e confirme as URLs.

## 3. AbacatePay

PIX (checkout transparente) e cartão de crédito (checkout hospedado da AbacatePay, PAY-007/ADR-022). Detalhes em `docs/payments.md` §10.

1. **Chave de API** (painel → Integração → API → Criar chave). As permissões **não podem ser editadas** depois: se a chave atual não tiver todas abaixo, crie uma nova e troque `ABACATEPAY_API_KEY` na Vercel (e faça *Redeploy*).

   | Permissão | Para quê |
   |---|---|
   | `TRANSPARENT:CREATE` | criar o PIX (e simular em Dev) |
   | `TRANSPARENT:READ` | reconsultar o PIX |
   | `CHECKOUT:CREATE` | criar o checkout de cartão |
   | `CHECKOUT:READ` | reconsultar o checkout de cartão |
   | `PRODUCT:READ` | achar o produto espelho do curso |
   | `PRODUCT:CREATE` | criar o produto espelho do curso (um por curso e preço, automático) |
   | `REFUND:CREATE` | botão "Reembolsar" do admin (PIX e cartão) |

   Sem uma delas a AbacatePay responde `403 Insufficient permissions` e o admin vê "A AbacatePay recusou a chave de API".
2. **Webhook** (painel AbacatePay → Webhooks): URL `https://<sua-url>/api/webhooks/abacatepay?webhookSecret=<o mesmo ABACATEPAY_WEBHOOK_SECRET>` com **os 8 eventos**:
   - PIX: `transparent.completed`, `transparent.refunded`, `transparent.disputed`, `transparent.lost`;
   - cartão: `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`.

   Se o webhook já existe só com os `transparent.*`, edite-o (ou recrie) para incluir os `checkout.*`.
3. **Cartão em Dev mode:** escolha "Cartão de crédito" no checkout, clique em "Pagar com cartão" e, na página da AbacatePay, use `4242 4242 4242 4242` (validade futura, qualquer CVV). Recusas: `4000 0000 0000 0002` (emissor), `…0069` (expirado), `…0127` (CVV). Não há "simular pagamento" por API para o checkout de cartão: pague pela página.
4. **Produção** (conta já aprovada):
   1. Desligue o Dev mode no painel e crie a chave de **produção** (`abc_prod_…`) com as 7 permissões acima → `ABACATEPAY_API_KEY` na Vercel (*Production*) → *Redeploy*.
   2. Crie o webhook **de novo no ambiente de produção** (webhooks de Dev não recebem eventos reais), com a URL de produção e os 8 eventos. Use um `ABACATEPAY_WEBHOOK_SECRET` novo e longo.
   3. Confirme `ABACATEPAY_API_BASE_URL` **ausente** na Vercel (com chave `abc_prod_` o app recusa qualquer outra base).
   4. Em **Perfil → Taxas** confira as taxas de cartão da conta (o parcelamento em até 12x é pago pela loja, ver ADR-022).
   5. Mantenha saldo na AbacatePay para reembolsos (saem do saldo disponível).
   6. Faça uma compra real de valor baixo com **PIX** e outra com **cartão**, confirme "Pagamento confirmado" e a matrícula; reembolse as duas pelo admin e confira que o acesso cai quando chega o `*.refunded`. Anote o que aparecer em `payment_events.processing_error` (fecha os "A CONFIRMAR" de `docs/payments.md` §10).
   7. Site no ar com CNPJ no rodapé, contato, `/termos` e `/privacidade` (exigência da AbacatePay).

## 4. Teste de compra PIX ponta a ponta (Dev mode, QA-004)

Pré-requisitos: passos 1–3 feitos, deploy na Vercel no ar, você é admin.

1. **Admin → Cursos → Novo**: crie um curso com preço (ex. R$ 10,00), um módulo e uma aula com um vídeo. Publique.
2. Em outra janela anônima, **cadastre um aluno de teste** (outro email) e confirme o email.
3. Como aluno, abra o curso em `/cursos` → **Comprar** → informe CPF de teste → a página do pedido mostra o QR e o copia-e-cola.
4. **Simule o pagamento** no Dev mode: pelo painel da AbacatePay (cobrança → simular pagamento) ou pelo seu terminal (a chave fica só no seu computador):
   ```bash
   curl -X POST "https://api.abacatepay.com/v2/transparents/simulate-payment" \
     -H "Authorization: Bearer $ABACATEPAY_API_KEY" -H "Content-Type: application/json" \
     -d '{"id":"<id da cobrança, pix_char_…>"}'
   ```
   O id aparece no painel da AbacatePay e na coluna `provider_billing_id` da tabela `orders` no Supabase.
5. Em até ~5 s a página do pedido deve virar **"Pagamento confirmado"** e o curso aparecer em **Minha biblioteca**. Abra uma aula.
6. Confira no Supabase (*Table Editor*): `orders.status = paid`, uma linha em `enrollments` com `source = purchase`, eventos em `payment_events`.
7. **Anote e me envie (sem chaves!)**: prints das telas e, se algo falhar, o conteúdo de `payment_events.processing_error` e o log da função na Vercel (*Deployments → Functions*). Isso fecha os itens "A CONFIRMAR" de `docs/payments.md`.

## 5. Rodar no seu computador (opcional)
```bash
npm install
cp .env.example .env.local   # preencha com os mesmos valores (pode usar outro projeto Supabase de dev)
npm run dev                   # http://localhost:3000
```

## Login com Google

1. Google Cloud Console → APIs e serviços → Tela de consentimento OAuth: tipo **Externo**, nome "Scorpion Bits Learn", email de suporte; publique o app.
2. Credenciais → Criar credenciais → **ID do cliente OAuth** → Aplicativo da Web.
   - URI de redirecionamento autorizado: `https://<projeto>.supabase.co/auth/v1/callback` (copie no Supabase, passo 3).
3. Supabase → Authentication → Sign In / Providers → **Google**: ative e cole o Client ID e o Client Secret.
4. Supabase → Authentication → URL Configuration: `Site URL` = domínio do learn; em Redirect URLs, `https://<domínio>/auth/callback**`.
5. Vercel → Settings → Environment Variables: `AUTH_GOOGLE_ENABLED=true` (Production) e faça Redeploy.

O nome do aluno vem do Google (`full_name`); o papel continua `student` (trigger `handle_new_user`).
