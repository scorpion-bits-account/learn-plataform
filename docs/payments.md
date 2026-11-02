# Pagamentos — AbacatePay

> Status: **contrato definido pelo spike `PAY-001` (2026-10-08)**, a partir da documentação oficial. `PAY-002`/`PAY-003` implementam o que está aqui. O que tem a marca **A CONFIRMAR** deve ser verificado em Dev mode antes do merge de `PAY-002`.
> Fontes: [índice da doc AbacatePay (llms.txt)](https://docs.abacatepay.com/llms.txt) e [índice da doc Cakto (llms.txt)](https://docs.cakto.com.br/llms.txt). Links específicos em cada item.

## Resumo das decisões do spike

| Tema | Decisão / descoberta |
|---|---|
| Versão da API | **v2** (`https://api.abacatepay.com/v2`). A v1 é legada: "toda a evolução da plataforma acontece na v2" ([v1/introduction](https://docs.abacatepay.com/pages/v1/introduction)). |
| Produto da API | **Checkout Transparente PIX** (`POST /v2/transparents/create`): o valor é enviado por cobrança (sem cadastrar produto), e há `externalId`, `expiresIn` e simulação em Dev mode. O QR Code é exibido na nossa página `/checkout/pedido/[id]`. Ver a justificativa em §1. |
| Autenticação do webhook | O **`webhookSecret` na query string é a única prova de origem**. O `X-Webhook-Signature` usa uma **chave pública, igual para todas as contas** e publicada na documentação. Ele só garante a integridade do corpo, nunca a autenticidade ([webhooks/security](https://docs.abacatepay.com/pages/webhooks/security)). Por isso a **reconsulta do status na API continua obrigatória** (ADR-008). |
| Eventos usados | `transparent.completed`, `transparent.refunded`, `transparent.disputed`, `transparent.lost` e, desde o PAY-007 (cartão), `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost` (§10). **Não existe evento de expiração nem de falha** para PIX: a expiração é tratada por consulta. |
| Taxa PIX | R$ 0,80 por transação, sem mensalidade ([concepts/taxas](https://docs.abacatepay.com/pages/concepts/taxas)). |
| Cakto | **Manter a AbacatePay no MVP (somente PIX). Reavaliar quando o cartão entrar no escopo.** Ver §9. |

---

## 1. Qual API usar (v1 ou v2, checkout hospedado ou transparente)

**v2.** A base é `https://api.abacatepay.com/v2` e o mesmo host atende Dev mode e produção: o ambiente é definido pela chave (`abc_dev_…` ou `abc_prod_…`) ([authentication](https://docs.abacatepay.com/pages/authentication), [production](https://docs.abacatepay.com/pages/production)). Os webhooks v2 têm payload `{ id, event, apiVersion: 2, devMode, data }` ([webhooks](https://docs.abacatepay.com/pages/webhooks)). O `POST /v1/billing/create` e o evento `billing.paid` do sistema antigo são v1 legado ([v1/webhooks](https://docs.abacatepay.com/pages/v1/webhooks)).

A v2 oferece dois caminhos para PIX:

| | **Checkout Transparente** (`/transparents/*`) ✅ escolhido | Checkout hospedado (`/checkouts/*`) |
|---|---|---|
| Valor | `data.amount` em centavos, **enviado por cobrança** ([transparents/create](https://docs.abacatepay.com/pages/transparents/create)) | Calculado a partir de `items[].id` de **produtos cadastrados antes** na AbacatePay ([payment/create](https://docs.abacatepay.com/pages/payment/create)). Seria preciso sincronizar o catálogo, e a v2 não tem endpoint de atualização de produto (só create/get/list/delete) ([llms.txt](https://docs.abacatepay.com/llms.txt)). |
| Métodos | PIX e Boleto ([transparents/reference](https://docs.abacatepay.com/pages/transparents/reference)) | PIX, Cartão (até 12x) e Boleto. Padrão `["PIX","CARD"]` ([payment/create](https://docs.abacatepay.com/pages/payment/create)) |
| UX | O QR Code (`brCodeBase64`) e o copia-e-cola (`brCode`) aparecem **no nosso site** | Redireciona para `app.abacatepay.com/pay/bill_…`, com `returnUrl`/`completionUrl` |
| Expiração | `expiresIn` (segundos). O padrão é 24 h ([concepts/pix](https://docs.abacatepay.com/pages/concepts/pix)) | "Por padrão, o link não expira" ([concepts/checkout](https://docs.abacatepay.com/pages/concepts/checkout)) |
| Simular pagamento (Dev) | `POST /transparents/simulate-payment` ([doc](https://docs.abacatepay.com/pages/transparents/simulate-payment)) | Para PIX no checkout hospedado, não há rota documentada: **A CONFIRMAR** |
| Status | `GET /transparents/check?id=` | `GET /checkouts/get?id=` ou `?externalId=` |

**Por que o transparente:** o preço continua congelado no nosso banco (`orders.amount_cents`) e vai direto na cobrança. Não precisamos espelhar o catálogo na AbacatePay, o teste ponta a ponta em Dev mode é automatizável e o aluno não sai do site. O polling de `/checkout/pedido/[id]` já estava no desenho. **Quando o cartão entrar no escopo**, o caminho é o checkout hospedado, porque o cartão transparente não está documentado na v2 (o evento `transparent.completed` tem exemplo com `CARD`, mas `transparents/create` só aceita `PIX`/`BOLETO`: **A CONFIRMAR**). Essa troca fica contida em `src/lib/payments/` (ADR-016).

Permissões mínimas da chave de API (crie uma chave só com estas) ([authentication](https://docs.abacatepay.com/pages/authentication#permissões-da-chave-de-api)): `TRANSPARENT:CREATE` (criar e simular), `TRANSPARENT:READ` (check/list) e `REFUND:CREATE` (somente se o reembolso for feito pela API). Sem a permissão, a API responde `401 Insufficient permissions`.

## 2. Criar a cobrança PIX — contrato do `createCheckout` (`PAY-002`)

`POST https://api.abacatepay.com/v2/transparents/create`
Headers: `Authorization: Bearer ${ABACATEPAY_API_KEY}`, `Content-Type: application/json`.
Fonte: [transparents/create](https://docs.abacatepay.com/pages/transparents/create) e [transparents/reference](https://docs.abacatepay.com/pages/transparents/reference).

```jsonc
{
  "method": "PIX",                         // obrigatório
  "data": {
    "amount": 4990,                        // obrigatório, centavos = orders.amount_cents (lido do servidor)
    "description": "Curso: Godot do zero", // opcional
    "expiresIn": 3600,                     // opcional, segundos (padrão 24 h). Sugestão: 3600
    "externalId": "<orders.id>",           // opcional. A doc o descreve como "ID no seu sistema para idempotência"
    "customer": {                          // opcional. Se enviado, os 4 campos são obrigatórios
      "name": "…", "email": "…", "taxId": "111.444.777-35", "cellphone": "(11) 4002-8922"
    },
    "metadata": { "orderId": "<orders.id>", "courseId": "<courses.id>" } // sem dados pessoais
  }
}
```

Resposta (envelope `{ data, success, error }`):

```json
{
  "data": {
    "id": "pix_char_abc123xyz",
    "amount": 4990,
    "status": "PENDING",
    "devMode": true,
    "brCode": "00020160014BR.GOV.BCB.PIX…",
    "brCodeBase64": "data:image/png;base64,iVBORw0KG…",
    "platformFee": 80,
    "receiptUrl": null,
    "createdAt": "…", "updatedAt": "…",
    "expiresAt": "2026-10-08T19:38:28.573Z",
    "metadata": { "orderId": "…" }
  },
  "success": true,
  "error": null
}
```

O que gravar no pedido: `provider_billing_id = data.id`, `expires_at = data.expiresAt`, `br_code = data.brCode` (o copia-e-cola). A imagem pode ser regenerada a partir de `brCodeBase64` a cada exibição ou guardada. **Não** guardamos `checkout_url`, porque o transparente não tem URL. A coluna `database.md › orders.checkout_url` pode virar `pix_br_code`, a decidir em `DB-00x`.

Observações:
- `customer`: se for enviado, `name`, `email`, `taxId` e `cellphone` são todos obrigatórios. Para Boleto, `name` e `taxId` são exigidos ([transparents/create](https://docs.abacatepay.com/pages/transparents/create)). Mantemos a coleta de CPF e telefone (já prevista).
- `ensureSameTaxId: true` obriga o pagador a ter o mesmo CPF do cliente. **Não usar no MVP**, porque um responsável pode pagar pelo aluno. Esse recurso também depende do provedor PIX da conta e é ignorado em Dev ([idem](https://docs.abacatepay.com/pages/transparents/create)).
- Comportamento de `externalId` repetido (devolve a cobrança existente ou dá erro?): **A CONFIRMAR**. Enquanto isso, a regra "reaproveitar pedido `pending` não expirado" (abaixo) evita uma segunda chamada.
- Há valor mínimo para PIX? A doc diz que "não há valor mínimo ou máximo definido pela AbacatePay", mas os limites do Banco Central e do banco do pagador podem se aplicar ([concepts/pix](https://docs.abacatepay.com/pages/concepts/pix)).
- `platformFee` mostra quanto foi descontado, em centavos ([concepts/taxas](https://docs.abacatepay.com/pages/concepts/taxas)). O exemplo da doc traz 100 e a tabela diz R$ 0,80: **A CONFIRMAR em Dev**.

## 3. Consultar o status — contrato do `getPaymentStatus` (reconciliação)

`GET https://api.abacatepay.com/v2/transparents/check?id=<provider_billing_id>` (permissão `TRANSPARENT:READ`) ([transparents/check](https://docs.abacatepay.com/pages/transparents/check)).

```json
{ "data": { "id": "pix_char_…", "status": "PAID", "expiresAt": "2026-03-04T15:48:59.876Z" }, "success": true, "error": null }
```

Os valores de `status` são `PENDING | EXPIRED | CANCELLED | PAID | UNDER_DISPUTE | REFUNDED | REDEEMED | APPROVED | FAILED` (o enum do OpenAPI tem mais valores que a tabela da página. Trate qualquer valor desconhecido como "não pago").

- A resposta **não traz valor**. Isso não é problema: o valor foi definido por nós na criação e a cobrança `provider_billing_id` está atrelada ao pedido no nosso banco. Portanto `fulfill_order` usa `orders.amount_cents` e compara com `paidAmount` do payload só para sanidade (se divergir, registra `processing_error` e alerta).
- Alternativas que trazem valor: `GET /transparents/list` (filtros **A CONFIRMAR**) e, para o checkout hospedado, `GET /checkouts/get?id=…|externalId=…`, com `amount`, `paidAmount` e `status` (`PENDING|PAID|EXPIRED|CANCELLED|REFUNDED`) ([payment/one](https://docs.abacatepay.com/pages/payment/one)).
- Se o webhook for perdido, a reconciliação admin ("Reconsultar pagamento") e o job de expiração usam este endpoint.

## 4. Webhook — contrato do `verifyWebhook` (`PAY-003`)

Cadastro: pelo painel ou por `POST /v2/webhooks/create` com `{ name, endpoint (HTTPS público), secret, events[] }` ([webhooks/create](https://docs.abacatepay.com/pages/webhooks/create)). Webhooks de Dev mode e de produção são **cadastros separados**. Ao ir para produção, o webhook precisa ser recriado ([production](https://docs.abacatepay.com/pages/production)). URL cadastrada: `https://<app>.vercel.app/api/webhooks/abacatepay?webhookSecret=<ABACATEPAY_WEBHOOK_SECRET>`. Não use redirect: o `3xx` não é seguido ([webhooks](https://docs.abacatepay.com/pages/webhooks)). Quando o domínio mudar, recrie o webhook (ADR-015).

Assine estes eventos: `transparent.completed`, `transparent.refunded`, `transparent.disputed`, `transparent.lost` e, para cartão (PAY-007, §10), `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`.

### 4.1 Verificação (duas camadas, nesta ordem)

| Camada | O que é | O que prova | Fonte |
|---|---|---|---|
| 1. `?webhookSecret=` | O `secret` que **nós** escolhemos no cadastro, enviado na query string de cada entrega | **Origem** (só nós e a AbacatePay o conhecemos) | [webhooks/security](https://docs.abacatepay.com/pages/webhooks/security) |
| 2. `X-Webhook-Signature` | Base64 de **HMAC-SHA256** do corpo bruto (UTF-8), com a **chave pública da AbacatePay** (constante publicada na doc, igual para todas as contas) | Só **integridade** do corpo. Qualquer pessoa consegue calcular, então **não autentica** | [webhooks/security](https://docs.abacatepay.com/pages/webhooks/security), [llms.txt](https://docs.abacatepay.com/llms.txt) |

Consequências:
- A chave HMAC **não é segredo**: é uma constante pública, igual para todas as contas. Ela fica no código como `ABACATEPAY_PUBLIC_HMAC_KEY` em `src/lib/payments/abacatepay-webhook.ts` (copiada da página de segurança, com o link), **não** em env. Se a AbacatePay a trocar, atualize a constante.
- O segredo viaja na URL e pode aparecer em logs de acesso. **Nunca logue `request.url` completo** e faça o rotate do secret se houver suspeita. Por isso, e conforme ADR-008, **o acesso só é liberado depois de reconsultar `/transparents/check`** com a nossa API key, que é o que de fato autentica o "pago".
- A CLI (`abacatepay listen`) **não** acrescenta `webhookSecret`: inclua-o em `--forward-to` ([cli/webhooks](https://docs.abacatepay.com/pages/cli/webhooks)).

### 4.2 Pseudocódigo (Route Handler, Node runtime)

```ts
// src/app/api/webhooks/abacatepay/route.ts — PSEUDOCÓDIGO, não é código de produção
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, 'utf8');
  const B = Buffer.from(b, 'utf8');
  return A.length === B.length && timingSafeEqual(A, B);
}

export async function POST(request: Request) {
  // 1) Origem: segredo da query string (não logar a URL)
  const secret = new URL(request.url).searchParams.get('webhookSecret') ?? '';
  if (!safeEqual(secret, process.env.ABACATEPAY_WEBHOOK_SECRET!)) {
    return new Response('unauthorized', { status: 401 }); // 4xx não é re-tentado
  }

  // 2) Integridade: HMAC-SHA256(base64) sobre o CORPO BRUTO, antes de qualquer JSON.parse
  const raw = await request.text();
  const signature = request.headers.get('x-webhook-signature') ?? '';
  const expected = createHmac('sha256', ABACATEPAY_PUBLIC_HMAC_KEY)
    .update(Buffer.from(raw, 'utf8'))
    .digest('base64');
  if (!safeEqual(expected, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  // 3) Parse tolerante: ler só os campos usados (a doc pede para NÃO validar o payload inteiro com Zod)
  const evt = JSON.parse(raw) as { id?: string; event?: string; devMode?: boolean; data?: any };
  if (!evt.id || !evt.event) return new Response('bad payload', { status: 400 });

  // 4) Rejeitar mistura de ambientes
  if (evt.devMode !== isDevKey(process.env.ABACATEPAY_API_KEY!)) return ok(); // registrar + ignorar

  // 5) Dedupe: INSERT payment_events(provider_event_id = evt.id) ON CONFLICT DO NOTHING → se já existia: 200
  // 6) Roteamento por evt.event (ver §5). Para "pago":
  //    orderId = evt.data.transparent.externalId; order = orders.find(orderId)
  //    status = GET /transparents/check?id=order.provider_billing_id  → precisa ser PAID
  //    rpc fulfill_order(order.id, order.provider_billing_id, order.amount_cents, evt.id)
  // 7) 200 ao terminar. Erro transitório (DB/API fora) → 500 (re-tentado). Erro de dado → 200 + processing_error + log.
}
```

### 4.3 Entrega e retentativas
Sucesso é qualquer `2xx` em até **30 s**. Falhas temporárias (timeout, erro de rede/DNS/TLS, `5xx`, `408`, `429`) são re-tentadas até 7 vezes em cerca de 18 h (5 s, 5 min, 30 min, 2 h, 5 h, 10 h). `3xx` e os demais `4xx` não são re-tentados. **`410` desativa o webhook.** Todas as tentativas têm o **mesmo `id`** (ex.: `log_abc123xyz`). O reenvio manual pelo painel gera um **novo `id`** ([webhooks](https://docs.abacatepay.com/pages/webhooks#entrega-e-retentativas)). Por isso a idempotência de `fulfill_order` também precisa valer por pedido, além do dedupe por evento.

> **A CONFIRMAR em Dev:** (a) os exemplos por evento ([events/transparent](https://docs.abacatepay.com/pages/webhooks/events/transparent)) **não mostram** o `id` de topo que a página geral garante. Confira se ele chega. (b) Em `data.transparent.id` o exemplo mostra `char_…`, enquanto o create devolve `pix_char_…`. Por isso o pedido é resolvido por **`data.transparent.externalId`** (= `orders.id`), e o id do provedor que vale é sempre o que gravamos na criação. (c) No exemplo de `*.refunded` aparece `status: "PAID"`. Não use `data.*.status` para decidir nada: decida pelo nome do evento e pela reconsulta.

## 5. Eventos → transição de `orders.status`

Payload comum ([events/transparent](https://docs.abacatepay.com/pages/webhooks/events/transparent)): `data.transparent { id, externalId, amount, paidAmount, platformFee, status, methods, customerId, receiptUrl, … }`, `data.customer` (com `taxId` mascarado), `data.payerInformation`, e `data.reason` em disputa e reembolso.

| Evento / sinal | Significado | Transição em `orders.status` | Efeito |
|---|---|---|---|
| `transparent.completed` | PIX confirmado | `pending → paid` (também `expired → paid`, se o PIX for pago depois que nosso job marcou expirado, **A CONFIRMAR** se isso é possível) | Reconsulta `check` = `PAID`, depois `fulfill_order` cria `enrollment(purchase)` |
| `transparent.refunded` | Reembolso concluído (pela API, pelo painel ou pela MED) | `paid → refunded` | Revoga a matrícula `purchase` daquele pedido (ADR-017) |
| `transparent.disputed` | Disputa aberta. No PIX, provavelmente MED (Mecanismo Especial de Devolução do BCB) | **sem mudança** (continua `paid`) e `payment_events` registra o evento | Log + alerta para o admin. Proposta: manter o acesso até o desfecho (**decisão do produto**) |
| `transparent.lost` | Disputa perdida (o dinheiro volta ao pagador) | `paid → refunded` | Revoga a matrícula. (Se quisermos diferenciar, criar `disputed_lost`. Hoje o enum não tem: decidir em `DB-00x`) |
| *(sem evento)* `check` = `EXPIRED` ou `CANCELLED` | QR expirou | `pending → expired` | Job de expiração e reconsulta admin. **Não há webhook de expiração** |
| *(sem evento)* `check` = `FAILED` | Falha | `pending → failed` | Idem |

Equivalentes no checkout hospedado (caso migremos): `checkout.completed | checkout.refunded | checkout.disputed | checkout.lost`, com `data.checkout` no lugar de `data.transparent` ([events/checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout)).

## 6. Testes em Dev mode

- Uma conta nova começa em Dev mode: os pagamentos são simulados e nada é cobrado ([devmode](https://docs.abacatepay.com/pages/devmode)). Use uma chave `abc_dev_…`. As respostas trazem `devMode: true`.
- **Simular o PIX:** `POST https://api.abacatepay.com/v2/transparents/simulate-payment?id=<pix_char_…>` (permissão `TRANSPARENT:CREATE`, só em Dev). Ele retorna a cobrança com `status: PAID` e dispara `transparent.completed` para o webhook de Dev ([simulate-payment](https://docs.abacatepay.com/pages/transparents/simulate-payment), [faq](https://docs.abacatepay.com/pages/faq)). Também funciona pela CLI: `abacatepay payments simulate <id>` ([cli/payments](https://docs.abacatepay.com/pages/cli/payments)).
- **Webhook local:** `abacatepay listen --forward-to "http://localhost:3000/api/webhooks/abacatepay?webhookSecret=…"`. A CLI assina com a mesma chave pública e grava o histórico em `~/.abacatepay/logs/transactions.log` ([cli/webhooks](https://docs.abacatepay.com/pages/cli/webhooks)). A CLI é um binário de desenvolvimento, não uma dependência npm. Mesmo assim, registre o uso em `docs/development.md`.
- **Reembolso em Dev:** é confirmado na hora, sem provedor real ([transparents/refund](https://docs.abacatepay.com/pages/transparents/refund)).
- Testes automatizados (`PAY-003`): use fixtures dos payloads da doc, assine-os com a chave pública e cubra: secret inválido → 401, assinatura inválida → 401, evento duplicado → 200 sem efeito, reconsulta ≠ PAID → não libera, valor divergente → `processing_error`.

## 7. Expiração, limites e taxas (AbacatePay)

| Item | Valor | Fonte |
|---|---|---|
| Expiração padrão do QR PIX | **24 h**. Configurável por `expiresIn` (segundos) no transparente | [concepts/pix](https://docs.abacatepay.com/pages/concepts/pix), [transparents/create](https://docs.abacatepay.com/pages/transparents/create) |
| `expiresIn` mínimo/máximo | **A CONFIRMAR** (não documentado) | — |
| Valor mín./máx. PIX | Nenhum definido pela AbacatePay. Limites do BCB e do banco do pagador podem se aplicar | [concepts/pix](https://docs.abacatepay.com/pages/concepts/pix) |
| Taxa PIX | **R$ 0,80** por transação, sem mensalidade | [concepts/taxas](https://docs.abacatepay.com/pages/concepts/taxas) |
| Cartão (futuro) | À vista 3,50% + R$ 0,60. 2–6x 4,00% + R$ 0,60. 7–12x 4,50% + R$ 0,60. No plano D+1 (padrão das contas novas), a taxa efetiva fica entre 5,42% + R$ 0,60 (1x) e 17,37% + R$ 0,60 (12x) | idem |
| Boleto | R$ 2,50 (só se for pago) | idem |
| Disponibilidade PIX | Imediata no saldo | [concepts/saques](https://docs.abacatepay.com/pages/concepts/saques) |
| Saque | PIX para chave do **mesmo CPF/CNPJ**: R$ 0,80 (até 20/mês), depois R$ 2,50. TED R$ 5,00. Limite diário depende da conta | [concepts/taxas](https://docs.abacatepay.com/pages/concepts/taxas), [concepts/saques](https://docs.abacatepay.com/pages/concepts/saques) |
| Produção | Exige **CNPJ**, site no ar com contato, termos de uso, política de privacidade e CNPJ no rodapé, além dos dados do sócio. Análise em até 24 h | [production](https://docs.abacatepay.com/pages/production) |
| Rate limit da API | **A CONFIRMAR** (não encontrado na doc v2) | — |

> ⚠️ O requisito de produção (termos, privacidade, CNPJ no rodapé, contato) afeta o backlog de UI/legal antes do lançamento.

## 8. Reembolso

**Como solicitar:** pelo painel ou por `POST https://api.abacatepay.com/v2/transparents/refund` com `{ "id": "pix_char_…", "reason": "…" }` (permissão `REFUND:CREATE`) ([transparents/refund](https://docs.abacatepay.com/pages/transparents/refund)). O reembolso pelo painel: **A CONFIRMAR** a tela (a doc da API não descreve).

```json
{ "data": { "id": "tran_abc123xyz", "status": "COMPLETE", "amount": 4990, "reason": "…", "originalId": "pix_char_…", "createdAt": "…" }, "success": true, "error": null }
```

Regras documentadas:
- **Somente reembolso total**, sem reembolso parcial.
- A transação PIX precisa estar `COMPLETE`. Transação em disputa não é reembolsável (`TRANSACTION_UNDER_DISPUTE`).
- O valor sai do **saldo disponível** da loja. Se o saldo for insuficiente, a resposta é `INSUFFICIENT_FUNDS`. ⚠️ Se a gente sacar tudo, o reembolso falha.
- É idempotente: uma segunda chamada devolve `400 "Esta cobrança já foi reembolsada."`. Trate isso como "já reembolsado".
- Também podem aparecer `LOCK_NOT_ACQUIRED` (tentar de novo), `TRANSACTION_NOT_REFUNDABLE` e `REFUND_REQUEST_FAILED`.
- **Evento:** `transparent.refunded` (ou `checkout.refunded` quando há billing associado).
- **Prazo máximo** para reembolsar uma cobrança pela AbacatePay: **não documentado (A CONFIRMAR com o suporte)**. A doc não impõe prazo mínimo nem máximo. A janela de 7 dias é aplicada **por nós**.
- O comprador **não** tem botão de reembolso na AbacatePay. O pedido de reembolso chega por nós (suporte ou admin). A MED/disputa é iniciada pelo banco do pagador.

**Política decidida pelo produto (2026-10-08, docs/product.md §3, que deixa de estar em aberto): seguir o CDC.** O aluno pode pedir reembolso em **até 7 dias da compra**. Quando o provedor **confirma** o reembolso (webhook `transparent.refunded`), o acesso é revogado automaticamente. **A regra dos "10 minutos" foi descartada.**
- **CDC art. 49:** em compras fora do estabelecimento comercial (internet), o consumidor pode desistir em **7 dias** a contar da assinatura ou do recebimento, com devolução imediata e corrigida de tudo o que pagou ([Lei 8.078/1990, art. 49](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm)).
- **Reembolso via API é possível nos dois provedores**, sem depender só do painel:
  - **AbacatePay:** `POST /v2/transparents/refund` (ou `/v2/checkouts/refund` no hospedado), total, sem janela imposta pelo provedor, condicionado a saldo disponível. Não há fluxo de "comprador pede reembolso" no provedor: o pedido chega por nós (botão do aluno ou suporte) e o **admin executa**. Também há `transparent.refunded` quando o reembolso é feito pelo painel ou pela MED ([transparents/refund](https://docs.abacatepay.com/pages/transparents/refund), [payment/refund](https://docs.abacatepay.com/pages/payment/refund)).
  - **Cakto:** `POST /public_api/orders/{id}/refund/` (reembolso imediato de pedido pago) e `POST /public_api/refunds/{id}/approve/` (antecipa um pedido do comprador). Além disso, o comprador pode pedir reembolso direto na Cakto (evento `refund_requested`, autoaprovação em `autoApproveAt`). O reembolso só fica `refunded` quando a adquirente confirma ([orders/refund](https://docs.cakto.com.br/api-reference/orders/refund), [refunds/approve](https://docs.cakto.com.br/api-reference/refunds/approve)).
- Implementação proposta (`PAY-003`/admin): o aluno vê "Solicitar reembolso" em `/minha-biblioteca` enquanto `now() <= paid_at + 7 dias`. O pedido vira registro para o admin. O admin aprova com `POST /v2/transparents/refund`. O webhook `transparent.refunded` dispara `orders.status='refunded'` e revoga a matrícula. **Depois dos 7 dias**, o admin ainda pode reembolsar por liberalidade (o prazo é um piso legal, não um teto técnico). O botão do aluno some, mas o botão do admin continua. **Nunca** revogar o acesso antes da confirmação do provedor.

---

## 9. Comparativo AbacatePay × Cakto (ADR-016)

| Critério | AbacatePay | Cakto |
|---|---|---|
| Posicionamento | Gateway via API: checkout hospedado ou transparente, links, assinaturas ([llms.txt](https://docs.abacatepay.com/llms.txt)) | Plataforma de **infoprodutos**: checkout, área de membros, afiliados, coprodução, order bump/upsell ([cakto.com.br](https://www.cakto.com.br/), [taxas](https://www.cakto.com.br/taxas)) |
| Taxa PIX | **R$ 0,80** fixo ([taxas](https://docs.abacatepay.com/pages/concepts/taxas)) | **0% + R$ 2,49** ("negociável"), mais **R$ 0,99 de "taxa de serviço" cobrada do comprador** em algumas contas ([cakto.com.br/taxas](https://www.cakto.com.br/taxas), [fees/retrieve](https://docs.cakto.com.br/api-reference/fees/retrieve)). Os termos de uso citam "tarifa inicial 8,99% + R$ 2,49", divergente da página de taxas: **A CONFIRMAR** qual vale para conta nova ([termos](https://cakto.com.br/termos-de-uso)) |
| Taxa cartão | 3,50%–4,50% + R$ 0,60 (5,42%–17,37% no plano D+1) | **4,99% + R$ 2,49**, até 12x, liberação em até 15 dias (ou 2 com antecipação). Juro de parcelamento repassado ([taxas](https://www.cakto.com.br/taxas)) |
| Outros métodos | Boleto (R$ 2,50) | Apple/Google Pay 8,99%, PicPay 6,99%, Pix Automático, Pix parcelado. **A emissão de boleto pela API saiu do contrato em 11/09/2026** ([fluxo-de-pagamento](https://docs.cakto.com.br/conceitos/fluxo-de-pagamento)) |
| Custos extras | Nenhum documentado além do saque | Chargeback R$ 60, pré-chargeback R$ 60, **MED R$ 19,90** por ocorrência, e taxas não são estornadas no reembolso. Retenção de até 100% por 180 dias se a fraude passar de 2% ([termos](https://cakto.com.br/termos-de-uso)) |
| Repasse / saque | PIX no saldo **na hora**. Saque PIX R$ 0,80 (20/mês), mesmo CPF/CNPJ | PIX liberado em **D+1**. Saque PIX "incluído na taxa". Prazo do saque "X dias úteis" na política (placeholder no próprio site) ([pagamentos](https://www.cakto.com.br/pagamentos)) |
| API para checkout próprio | Sim. Transparente PIX com **valor livre por cobrança** (`amount`) | Sim, `POST /public_api/payments/` (PIX e cartão com token do SDK), mas **exige uma oferta (`offerId`) cadastrada**, exatamente 1 item, `X-Idempotency-Key` obrigatório, `customer.fingerprint` obrigatório e **devolve só o `qrCode` em texto** (a imagem é gerada por nós). Rate limit de 60/min por IP ([create-pix](https://docs.cakto.com.br/api-reference/payments/create-pix)) |
| Correlação com nosso pedido | `externalId` e `metadata` livres | No checkout hospedado, `?callback=<token>` volta no webhook. O redirect pós-pagamento **depende de liberação do Compliance** ([redirect](https://docs.cakto.com.br/conceitos/redirect-pos-pagamento)). Na API direta, o `metadata` só aceita UTM/`sck`, então correlaciona-se pelo `id` do pedido Cakto ([create-pix](https://docs.cakto.com.br/api-reference/payments/create-pix)) |
| Autenticação da API | Bearer API key com permissões por rota | OAuth2 `client_credentials` → token Bearer ([authentication](https://docs.cakto.com.br/authentication)) |
| Webhook: assinatura | `webhookSecret` na URL (origem) + HMAC com **chave pública** (só integridade) | **Mais forte:** `X-Cakto-Signature: v1=<hex HMAC-SHA256(secret, "{timestamp}.{corpo}")>` + `X-Cakto-Timestamp` (anti-replay de 5 min). O `secret` também vem no corpo ([webhooks](https://docs.cakto.com.br/conceitos/webhooks)) |
| Webhook: retentativas | Até 7 em ~18 h, inclusive para `5xx` | **Fraco:** só re-tenta em timeout/rede (5 vezes em ~40 min). **Resposta `5xx` não é re-tentada**: é preciso reenviar manualmente ou por API. Timeout de **8 s** ([webhooks](https://docs.cakto.com.br/conceitos/webhooks)) |
| Eventos | completed / refunded / disputed / lost | `purchase_approved`, `purchase_refused`, `refund`, `refund_requested`, `chargeback`, `pix_gerado`, `checkout_abandonment`… Valores em reais com tipos mistos (number e string) |
| Reembolso | API ou painel, total, sem fluxo do comprador | API `POST /orders/{id}/refund/`. O **comprador pode pedir reembolso** (janela com `autoApproveAt`, efetivado automaticamente se ninguém agir) ([refunds/list](https://docs.cakto.com.br/api-reference/refunds/list), [refunds/approve](https://docs.cakto.com.br/api-reference/refunds/approve)). Política: 7 dias para digitais, devolução em 7–15 dias úteis ([reembolso](https://www.cakto.com.br/reembolso)) |
| Sandbox | Dev mode self-service + `simulate-payment` + CLI `listen` | Staging **mediante pedido ao suporte**. A URL não é pública ([ambientes](https://docs.cakto.com.br/conceitos/ambientes)) |
| Área de membros | Não tem (só `fileUrl` de PDF em produto) | **Cakto Members**, gratuita, com vídeo ilimitado ([termos](https://cakto.com.br/termos-de-uso), [taxas](https://www.cakto.com.br/taxas)). **Não é obrigatória** para usar a API/webhooks, mas o modelo nativo da plataforma é "compra vira acesso na Cakto". `POST /orders/{id}/resend_access/` concede acesso **independentemente do status** ([resend-access](https://docs.cakto.com.br/api-reference/orders/resend-access)). Ela concorre diretamente com a nossa plataforma |
| Esforço de integração (para o nosso desenho) | **Baixo**: 3 chamadas (create, check, refund) + webhook | **Médio/alto**: sincronizar produto/oferta por curso (preço fica na Cakto, o que entra em conflito com "preço congelado no nosso banco"), OAuth com renovação de token, fingerprint, idempotency key, geração de QR, compensar a falta de retry em `5xx` (job lendo `event-history`), pedir staging e liberação de compliance |

### Riscos
- **AbacatePay:** (1) A autenticação do webhook depende de um segredo em query string, e o HMAC é público. Mitigação: reconsulta obrigatória + não logar a URL. (2) A empresa é mais nova e menor: risco de mudança de API (já houve a ruptura v1→v2) e documentação com pequenas inconsistências (prefixos de id, `id` ausente nos exemplos, `platformFee`). (3) O reembolso depende de saldo na conta. (4) Produção exige CNPJ e site com páginas legais.
- **Cakto:** (1) Lock-in de catálogo (oferta e preço na Cakto) e incentivo a usar a área de membros dela. (2) Webhook sem retry para `5xx`. (3) PIX mais caro para tickets abaixo de cerca de R$ 300 (R$ 2,49 contra R$ 0,80, mais R$ 0,99 para o comprador), além de multas de MED/chargeback. (4) Termos com tarifa "inicial" divergente da página pública. (5) Sem sandbox self-service.

### Recomendação
**Manter a AbacatePay no MVP (somente PIX) e reavaliar quando o cartão entrar no escopo.**

Justificativa: no PIX, a AbacatePay é mais barata (R$ 0,80 contra R$ 2,49 + R$ 0,99), libera o dinheiro na hora e encaixa no nosso modelo (preço e pedido no nosso banco, acesso só por `fulfill_order`), com o menor esforço e com Dev mode self-service. Os pontos fortes da Cakto (área de membros, afiliados, order bump, comprador pedir reembolso, assinatura de webhook com timestamp) servem a quem **não** tem plataforma própria. Para nós, metade disso compete com o produto, e a outra metade exige mover catálogo e preço para fora do nosso banco. A Cakto volta a fazer sentido se o produto quiser **afiliados** ou se o cartão com antifraude e 3DS pesar mais do que o custo e o acoplamento. Nesse caso, abrir nova ADR comparando com o checkout hospedado de cartão da AbacatePay (3,5% + R$ 0,60 contra 4,99% + R$ 2,49).

---

## 10. Cartão (PAY-007)

> Spike de 2026-11-02 sobre a documentação atual ([llms.txt](https://docs.abacatepay.com/llms.txt)). Decisão registrada na **ADR-022**. O que a doc não responde está marcado **A CONFIRMAR** (testar em Dev mode e no primeiro pagamento real de produção).

### 10.1 Como cobrar cartão no nosso desenho (preço no nosso banco, nosso `orderId`)

Há dois caminhos documentados na v2:

| | **Checkout hospedado** (`/v2/checkouts/*`) ✅ escolhido | Cartão no checkout transparente (`/v2/transparents/create`, `method: "CARD"`) |
|---|---|---|
| Valor | **Não aceita valor livre**: o total é calculado a partir de `items[].id` (produtos cadastrados). Só `items` é obrigatório ([payment/create](https://docs.abacatepay.com/pages/payment/create)) | `data.amount` livre por cobrança, mínimo `100` ([transparents/card](https://docs.abacatepay.com/pages/transparents/card)) |
| Nosso `orderId` | `externalId` e `metadata` livres; voltam no `GET /checkouts/get` e no webhook em `data.checkout.externalId` ([payment/create](https://docs.abacatepay.com/pages/payment/create), [events/checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout)) | **`externalId` é ignorado no cartão**; só `metadata` (todos os valores texto) ([transparents/card](https://docs.abacatepay.com/pages/transparents/card)) |
| Dados do cartão | Digitados no site da AbacatePay (`app.abacatepay.com/pay/bill_…`). Nada passa por nós | Iframe do `abacatepay.js` (script de `abacatepay.com` carregado **na nossa página**) gera um `ctok_` de 60 s, uso único, atrelado ao `amount`; nosso backend envia o token ([guides/cartao-transparente](https://docs.abacatepay.com/pages/guides/cartao-transparente), [abacatepay-js](https://docs.abacatepay.com/pages/transparents/abacatepay-js)) |
| Chaves | Só a chave de API | Chave de API + **chave pública** `pk_…` no navegador ([public-key](https://docs.abacatepay.com/pages/transparents/public-key)) |
| Liberação na conta | Cartão no checkout (o que a conta recebeu) | Exige `CARD_TRANSPARENTS` liberado à parte, senão `CARD_TRANSPARENTS is not available for this store` ([transparents/card#erros](https://docs.abacatepay.com/pages/transparents/card)) |
| Status de "pago" | `PAID` no checkout | `APPROVED` (liberar) → `PAID` (repasse da adquirente); `transparents/check` é **só PIX**, cartão usa `GET /transparents/get` |
| Riscos | Produto espelhado na AbacatePay; aluno sai do site | Script de terceiro no nosso domínio (CSP, cadeia de suprimentos, nova dependência → ADR); 3DS em janela própria; timeout ≠ recusa (risco de cobrança em dobro com `cardToken`); só Visa/Mastercard; `customer` completo obrigatório |

**Escolha: checkout hospedado, só com `methods: ["CARD"]`** (o PIX continua no transparente). Motivos: os dados de cartão nunca tocam o nosso servidor **nem a nossa página** (o formulário é da AbacatePay), não precisamos de script de terceiro nem de `CARD_TRANSPARENTS`, e o `externalId` = `orders.id` volta no webhook como já fazemos no PIX.

**Como manter o preço do nosso banco** com um checkout que só aceita produtos:
1. O pedido nasce com `amount_cents` lido do curso (igual ao PIX).
2. O servidor espelha um **produto avulso por (curso, preço)**: `externalId = "course-<courseId>-<amountCents>"`, `price = amountCents`, `currency: "BRL"`, sem `cycle`. Busca com `GET /v2/products/get?externalId=` e, se não existir (404), cria com `POST /v2/products/create` ([products/create](https://docs.abacatepay.com/pages/products/create), [products/get](https://docs.abacatepay.com/pages/products/get)). Mudou o preço → muda o `externalId` → produto novo (a v2 não tem rota de atualização de produto). Produto de Dev mode não existe em produção (campo `devMode`): o primeiro checkout de produção cria o seu.
3. `POST /v2/checkouts/create` com `items: [{ id: <prod_…>, quantity: 1 }]`, `methods: ["CARD"]`, `externalId: orders.id`, `metadata: { orderId, courseId }`, `card: { maxInstallments }`, `returnUrl` e `completionUrl` = `/checkout/pedido/<orderId>` ([payment/create](https://docs.abacatepay.com/pages/payment/create)). Sem `coupons`, sem `customerId`, sem `passFeesToCustomer`.
4. **Sanidade antes do redirect:** a resposta precisa ter `amount === orders.amount_cents`, `externalId === orders.id` (se vier) e `url` em `https://app.abacatepay.com/…`. Qualquer divergência → pedido `failed`, nada é exibido ao aluno. (Se alguém editar o preço do produto no painel, o checkout sai com outro valor e é recusado aqui; ver A CONFIRMAR.)
5. Gravamos `provider_billing_id = data.id` (`bill_…`) e `checkout_url = data.url`, e fazemos `redirect` para a URL.

A CONFIRMAR: (a) `POST /products/create` com `externalId` repetido (erro ou devolve o existente?) — tratamos `get` 404 → `create`, e numa corrida o `create` falho é seguido de novo `get`; (b) se o produto editado no painel muda o `amount` de checkouts novos (esperado: sim, por isso a checagem); (c) se o checkout aceita cupons digitados pelo cliente sem `coupons` na criação (esperado: não; mesmo assim exigimos `paidAmount` = `amount_cents` na reconsulta, e `REDEEMED` não libera).

### 10.2 Parcelamento

- **Quem configura:** a API, por checkout: `card.maxInstallments` (1–12); o cliente escolhe no checkout de 1x até o máximo ([payment/installments](https://docs.abacatepay.com/pages/payment/installments)). Não achamos configuração de painel que se sobreponha: **A CONFIRMAR**.
- **Limites:** até 12x; **parcela mínima de R$ 10,00** (`"Total below minimum for Nx (R$10 per installment)"`). Por isso enviamos `maxInstallments = min(CARD_MAX_INSTALLMENTS, floor(amount_cents / 1000))`, nunca abaixo de 1.
- **Juros/taxa por conta de quem:** por padrão, **da loja** — a taxa sobe com as parcelas (tabela em §7: 3,50% à vista, 4,00% 2–6x, 4,50% 7–12x + R$ 0,60; no plano D+1, efetiva de 5,42% a 17,37%). A taxa exata da conta fica em **Perfil → Taxas** ([concepts/taxas](https://docs.abacatepay.com/pages/concepts/taxas)). `card.passFeesToCustomer: true` repassa a taxa ao cliente (o checkout mostra o total de cada opção), mas exige conta "Rinne" habilitada e muda o `amount` do webhook para o total pago ([guides/repasse-de-taxa](https://docs.abacatepay.com/pages/guides/repasse-de-taxa)). **Não usamos** (o valor cobrado deixaria de ser `amount_cents`). Repassar juros ao aluno é decisão do produto (**A CONFIRMAR**); se decidido, a checagem de valor precisa passar a usar `amount - customerFee`.
- Depois do pagamento, `installmentsCount` mostra as parcelas escolhidas (`null` à vista).

### 10.3 Webhooks do checkout e reconsulta autenticada

Eventos ([webhooks/reference](https://docs.abacatepay.com/pages/webhooks/reference), [events/checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout)): **`checkout.completed`**, **`checkout.refunded`**, **`checkout.disputed`**, **`checkout.lost`**. Mesmo envelope v2 `{ id: "log_…", event, apiVersion: 2, devMode, data }` e a mesma verificação (`webhookSecret` + HMAC público) ([webhooks](https://docs.abacatepay.com/pages/webhooks), [webhooks/security](https://docs.abacatepay.com/pages/webhooks/security)).

```jsonc
// data de checkout.completed (cartão) — campos que usamos
{ "checkout": { "id": "bill_abc123xyz", "externalId": "<orders.id>", "amount": 10000, "paidAmount": 10000,
                "status": "PAID", "methods": ["CARD"], "installmentsCount": null, "customerFee": null },
  "customer": { "taxId": "123.***.***-**" }, "payerInformation": { "method": "CARD", "CARD": { "number": "1234", "brand": "VISA" } } }
```

- Pedido resolvido por `data.checkout.externalId`; a cobrança que vale é a gravada (`bill_…`).
- **Reconsulta (equivalente ao `transparents/check`):** `GET /v2/checkouts/get?id=bill_…` (permissão `CHECKOUT:READ`), que traz `status` (`PENDING | EXPIRED | CANCELLED | PAID | REFUNDED | REDEEMED`), `amount`, `paidAmount` e `externalId` ([payment/one](https://docs.abacatepay.com/pages/payment/one)). Liberar só com `PAID`, `amount` = `amount_cents`, `paidAmount` (se vier) = `amount_cents` e `externalId` (se vier) = `orders.id`.
- Os exemplos de `checkout.refunded`/`checkout.disputed` trazem `status: "PAID"` dentro de `data.checkout`: como no PIX, decidimos pelo **nome do evento + reconsulta**, nunca por `data.*.status`.
- Upsell gera um segundo `checkout.completed` com o mesmo `checkout.id` ([events/checkout#upsell](https://docs.abacatepay.com/pages/webhooks/events/checkout)); não usamos upsell, e o dedupe é pelo `id` do evento.
- A CONFIRMAR: (a) `checkout.lost` aparece na tabela de [webhooks/reference](https://docs.abacatepay.com/pages/webhooks/reference) mas não na de [webhooks](https://docs.abacatepay.com/pages/webhooks) — assinar mesmo assim; (b) se, no cartão, `GET /checkouts/get` já devolve `PAID` logo após a aprovação (o exemplo do evento sim; `PENDING` é tratado como transitório → 503, a AbacatePay re-tenta); (c) qual `status` a reconsulta mostra depois de `checkout.lost` (exigimos `REFUNDED`, como no PIX; senão fica `processing_error` para o admin).

### 10.4 Reembolso e chargeback

- **Rota:** `POST /v2/checkouts/refund` com `{ id: "bill_…", reason }`, permissão **`REFUND:CREATE`** (a mesma do PIX) ([payment/refund](https://docs.abacatepay.com/pages/payment/refund)). O `id` também aceita `card_…`/`char_…`.
- **Regras:** só reembolso **total**; cartão precisa estar `APPROVED` ou `COMPLETE`; em disputa não reembolsa (`TRANSACTION_UNDER_DISPUTE`); sai do saldo `available` (ou `pending`, em casos de cartão) → senão `INSUFFICIENT_FUNDS`; idempotente (`"Esta cobrança já foi reembolsada."`); em Dev é instantâneo. Mesmos códigos de erro do PIX (`LOCK_NOT_ACQUIRED`, `TRANSACTION_NOT_REFUNDABLE`, `REFUND_REQUEST_FAILED`, `REFUND_CONFIRMATION_FAILED`…). Conclui com **`checkout.refunded`**. A taxa do cartão **não é devolvida** à loja ([guides/repasse-de-taxa](https://docs.abacatepay.com/pages/guides/repasse-de-taxa)).
- **Prazos:** prazo máximo para reembolsar e em quanto tempo o estorno aparece na fatura do aluno **não estão documentados** (**A CONFIRMAR** com o suporte). O texto da tela de reembolsado já diz que pode levar alguns dias.
- **Chargeback/disputa:** não há página dedicada; só os eventos `checkout.disputed` (com `data.reason`) e `checkout.lost` ([webhooks/reference](https://docs.abacatepay.com/pages/webhooks/reference)). O status `UNDER_DISPUTE` existe para cobranças de cartão ([transparents/card#status](https://docs.abacatepay.com/pages/transparents/card)). Tratamento igual ao PIX: `disputed` só registra e alerta (acesso mantido), `lost` revoga via `refund_order`. Taxa de chargeback, prazo de defesa e envio de evidências: **A CONFIRMAR** (não documentados).

### 10.5 Permissões da chave e Dev × produção

Permissões ([authentication#permissões-da-chave-de-api](https://docs.abacatepay.com/pages/authentication)). As permissões **não podem ser editadas** depois de criada a chave: é preciso criar uma chave nova. Sem permissão, a API agora responde **403** `Insufficient permissions` (tratamos 401 e 403 como "chave recusada").

| Permissão | Para quê |
|---|---|
| `TRANSPARENT:CREATE` | Criar PIX (e `simulate-payment` em Dev) |
| `TRANSPARENT:READ` | Reconsultar PIX (`/transparents/check`) |
| `CHECKOUT:CREATE` | **Novo:** criar o checkout de cartão |
| `CHECKOUT:READ` | **Novo:** reconsultar o checkout (`/checkouts/get`) |
| `PRODUCT:READ` | **Novo:** achar o produto espelho (`/products/get?externalId=`) |
| `PRODUCT:CREATE` | **Novo:** criar o produto espelho |
| `REFUND:CREATE` | Reembolso pelo admin (PIX e cartão) |

Dev × produção ([devmode](https://docs.abacatepay.com/pages/devmode), [production](https://docs.abacatepay.com/pages/production)):
- Mesmo host; o ambiente vem da chave (`abc_dev_…` × `abc_prod_…`). Webhooks de Dev **não** valem em produção: recriar com os 8 eventos.
- Em Dev, o cartão do checkout hospedado é pago **no navegador** com `4242 4242 4242 4242` (validade futura, qualquer CVV); recusas: `…0002` (emissor), `…0069` (expirado), `…0127` (CVV). **Não há rota documentada para simular o pagamento de um checkout** (A CONFIRMAR; no E2E o mock tem uma).
- Produtos são por ambiente (`devMode`): os de Dev não aparecem em produção.
- Produção: em produção só Visa e Mastercard estão documentados para o transparente; bandeiras aceitas no hospedado **A CONFIRMAR**. 3DS pode ser pedido pelo banco (é tratado na página da AbacatePay).

### 10.6 Fluxo implementado

```text
/checkout/[slug] (PIX | Cartão) ── startCheckout(paymentMethod=card)
  → orders(pending, payment_method=card, amount_cents do banco)
  → products/get?externalId=course-<id>-<cents> (404 → products/create)
  → checkouts/create {items, methods:[CARD], externalId=order.id, card.maxInstallments, returnUrl/completionUrl}
  → confere amount/externalId/url → grava provider_billing_id=bill_…, checkout_url → redirect(app.abacatepay.com/pay/bill_…)
Aluno paga na AbacatePay → volta para /checkout/pedido/<id> (polling + reconsulta checkouts/get no plano B)
checkout.completed → webhook (segredo + HMAC + dedupe) → checkouts/get = PAID e valores batem → fulfill_order
checkout.refunded | checkout.lost → checkouts/get = REFUNDED → refund_order · checkout.disputed → registra + ALERTA
Admin: Reconsultar (checkouts/get) · Reembolsar (checkouts/refund)
```

Webhook `checkout.*`: o pedido precisa ser `payment_method = card` (evento de checkout em pedido PIX, ou `transparent.*` em pedido de cartão → `method_mismatch`, 200). A reconsulta `checkouts/get` precisa dizer `PAID`, com `amount`/`paidAmount` = `amount_cents` e `externalId` = `orders.id` (decisão única em `src/lib/payments/verdict.ts`, usada também pelo polling e pelo admin). `PENDING` → 503 (re-tentado).

Pedido de cartão pendente é reaproveitado por **1 h** (`expires_at`; mesma URL do checkout). Depois disso, ou se o aluno trocar de método, ele vira `expired` e um novo é criado; se o checkout antigo ainda for pago, `fulfill_order` aceita `expired → paid` (e um pagamento em duplicidade aparece como `paid_already_enrolled` para o admin reembolsar).

---

## Desenho (atualizado pelo PAY-001)

```text
Aluno ──▶ /checkout/[slug] ──startCheckout()──▶ orders(pending, amount_cents congelado)
            │                                    └─▶ POST /v2/transparents/create {amount, externalId=order.id, expiresIn}
            │                                         ◀── {id: pix_char_…, brCode, brCodeBase64, expiresAt}
            └─▶ redirect /checkout/pedido/[id]  (mostra QR + copia-e-cola + contador de expiração; polling do status do PRÓPRIO pedido)
   paga PIX no app do banco
AbacatePay ──webhook──▶ /api/webhooks/abacatepay?webhookSecret=…
   1. webhookSecret (timingSafeEqual) → 401; X-Webhook-Signature = HMAC-SHA256(base64, chave pública, corpo bruto) → 401
   2. INSERT payment_events (provider_event_id = evt.id, unique) → conflito: 200 (duplicado)
   3. transparent.completed → order = orders[data.transparent.externalId]
   4. GET /v2/transparents/check?id=order.provider_billing_id → precisa ser PAID (fonte de verdade, autenticada pela nossa API key)
   5. rpc fulfill_order(order.id, provider_billing_id, order.amount_cents, evt.id) → transação idempotente:
      pending→paid, cria enrollment(source=purchase). paidAmount do payload ≠ amount_cents → processing_error + alerta
   6. transparent.refunded | transparent.lost → paid→refunded + revoga enrollment do pedido; transparent.disputed → só registra + alerta
   7. 200. Transitório → 500 (re-tentado até ~18 h). Erro de dado → 200 + processing_error.
Job/admin "Reconsultar" ── GET /transparents/check ──▶ PAID → fulfill_order · EXPIRED/CANCELLED → expired · FAILED → failed
```

## Regras
- **Preço nunca vem do cliente.** `amount_cents` é lido do curso no servidor, congelado no pedido e enviado como `data.amount`.
- Um pedido `pending` existente e **não expirado** (`expires_at > now()`) para o mesmo usuário e curso é reaproveitado: mostra o mesmo QR (cobre clique duplo e "voltar"). Se estiver expirado, marca `expired` e cria um novo.
- Usuário que já tem acesso não pode iniciar checkout (409 amigável → "Você já possui este curso").
- A página do pedido **nunca** concede acesso. Ela só exibe o estado do pedido.
- CPF e telefone são validados (dígito verificador do CPF) e salvos em `profiles` apenas do próprio usuário. Se `customer` for enviado à AbacatePay, os 4 campos (`name`, `email`, `taxId`, `cellphone`) são obrigatórios.
- Webhook: `webhookSecret` + HMAC sobre `request.text()` + dedupe por `evt.id` + **reconsulta `check` antes de liberar**. Não validar o payload inteiro com Zod (recomendação da AbacatePay). Ler só os campos usados.
- Reembolso (`transparent.refunded`, ou `transparent.lost`) marca `orders.status='refunded'` e revoga a matrícula de origem `purchase` daquele pedido (ADR-017). Reembolso iniciado por nós usa `POST /v2/transparents/refund`. Tratar `"Esta cobrança já foi reembolsada."` como sucesso e `INSUFFICIENT_FUNDS` como erro exibido ao admin.
- **Política de reembolso (decidida, Q8b): CDC art. 49.** O aluno pode pedir reembolso em até **7 dias da compra** (`paid_at + 7 dias`). O admin executa via API. O acesso é revogado **automaticamente quando o provedor confirma** (`transparent.refunded`), nunca antes. A regra de "10 minutos" foi descartada. Mantenha saldo suficiente na AbacatePay para cobrir os reembolsos da janela de 7 dias (o reembolso é debitado do saldo).
- Disputa (`transparent.disputed`) só registra e alerta. Manter ou suspender o acesso durante a disputa é **decisão do produto**.
- Métodos: **PIX** (transparente) e, desde o PAY-007, **cartão** (checkout hospedado, §10/ADR-022). Domínio: URL padrão Vercel. Ao trocar o domínio, recriar o webhook (Dev e produção são cadastros separados).
- Admin: botão "Reconsultar pagamento" (`check`) e job de expiração de pendentes (pós-MVP: Vercel Cron).
- Logs sem CPF completo, sem payload bruto com dados pessoais e **sem a URL do webhook (contém o segredo)**.
- Env: `ABACATEPAY_API_KEY` (dev `abc_dev_…` / prod `abc_prod_…`), `ABACATEPAY_WEBHOOK_SECRET`. A chave HMAC é **pública** (ver §4.1).

## Implementado — webhook (`PAY-003`)

**URL a cadastrar no painel da AbacatePay** (um cadastro para Dev, outro para produção), com os eventos `transparent.completed`, `transparent.refunded`, `transparent.disputed`, `transparent.lost`, `checkout.completed`, `checkout.refunded`, `checkout.disputed` e `checkout.lost`:

```text
https://<app>.vercel.app/api/webhooks/abacatepay?webhookSecret=<ABACATEPAY_WEBHOOK_SECRET>
```

Código: rota `src/app/api/webhooks/abacatepay/route.ts` (Node, só adapta Request/Response; `GET` → 405), lógica em `src/features/payments-webhook/handler.ts`, banco em `store.ts` (service role), chave HMAC pública em `src/lib/payments/abacatepay-webhook.ts` (constante, não é env).

Comportamento, na ordem:
1. Sem env de pagamentos → `503`. `webhookSecret` ≠ env (tempo constante) → `401`.
2. Corpo bruto até **64 KB** (`Content-Length` ou leitura em stream) → senão `413`. `X-Webhook-Signature` inválida → `401`. JSON ilegível / sem `event` ou `data` → `400`.
3. Chave `abc_prod_` + `devMode: true` → `200 ignored_dev_mode` (nada gravado).
4. `INSERT payment_events` (payload **reduzido**: id, event, devMode e `data.transparent.{id, externalId, amount, paidAmount, status}`; sem dados do pagador). Conflito: já processado ou com erro de dado → `200 duplicate`; ainda pendente (falha transitória anterior) → reprocessa. Sem `id` de topo, a chave vira `<event>:<data.transparent.id>`.
5. Pedido por `data.transparent.externalId` (= `orders.id`). Cobrança reconsultada = a gravada no pedido; o id do evento precisa casar (tolera `char_…` × `pix_char_…`). Pedido sem cobrança gravada (`failed` por timeout no `PAY-002`) usa a do evento, se nenhum outro pedido a usa.
6. `completed`: pedido `pending|expired|failed` → `GET /transparents/check` = `PAID` → `fulfill_order(order.id, billing, data.transparent.amount, eventId)`. `check` = `PENDING` (provedor ainda não refletiu o pagamento) é **transitório**: o evento fica não processado (sem `processing_error`/`processed_at`) e a resposta é `503`, para a AbacatePay re-tentar e o evento ser reprocessado. Outros status ≠ `PAID` (`EXPIRED`, `CANCELLED`…) são erro de dado. Pedido já `paid` → `already_paid` sem reconsulta. `refunded`/`lost`: pedido `paid` → `check` = `REFUNDED` → `refund_order`. `disputed`: só registra (`processed_at`) e loga `ALERTA`.
7. Respostas: `200` para processado, duplicado e erro de dado (`order_not_found`, `billing_mismatch`, `amount_mismatch`, `invalid_status`, `provider_status_<status>`, `provider_check_rejected`, `unsupported_event` — gravados em `processing_error`). `500` para banco ou provedor indisponível e `503 provider_pending` para reconsulta ainda `PENDING` (a AbacatePay re-tenta até 7x em ~18 h; se esgotar, resta o "Reconsultar pagamento" do admin). Logs `[webhook:abacatepay]` só com eventId, tipo, orderId e resultado.

Migration `20261009000007_fulfill_failed_orders.sql`: `fulfill_order` também aceita `failed → paid`.

## Implementado — reconsulta no polling do aluno (plano B ao webhook)
`getOrderStatus` (`src/features/checkout/actions.ts`): com o pedido `pending` e cobrança gravada, reconsulta `GET /transparents/check` pela nossa chave no máximo 1×/10 s por pedido (por instância). Só `PAID` (e valor igual a `orders.amount_cents`, quando informado) chama `fulfill_order()` — a mesma função idempotente do webhook. Motivo: no QA-004 o PIX foi pago e a tela não atualizou; o acesso não pode depender só da entrega do webhook. Falhas da reconsulta são logadas e não quebram o polling.

## Pendências (A CONFIRMAR em Dev mode / suporte)
1. Presença do `id` de topo em `transparent.*` e o formato de `data.transparent.id` (`pix_char_…` ou `char_…`).
2. Comportamento de `externalId` repetido em `/transparents/create`.
3. Limites de `expiresIn` e rate limit da API v2.
4. `platformFee` real do PIX (0,80 ou 1,00).
5. Pagamento de QR depois de `expiresAt` é possível? Se sim, o pedido `expired` precisa aceitar `→ paid`.
6. Prazo máximo para reembolsar pela AbacatePay e reembolso pelo painel.
7. Cakto: tarifa vigente para conta nova (página de taxas: 0% + R$ 2,49; termos: 8,99% + R$ 2,49).
