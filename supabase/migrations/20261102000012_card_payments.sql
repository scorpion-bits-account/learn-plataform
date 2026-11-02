-- =============================================================================
-- PAY-007 — Cartão de crédito pelo checkout hospedado da AbacatePay (ADR-022)
-- =============================================================================
-- O pedido passa a registrar o MÉTODO escolhido pelo aluno:
--   pix  -> checkout transparente (QR em /checkout/pedido/[id]); provider_billing_id = pix_char_…
--   card -> checkout hospedado (app.abacatepay.com/pay/bill_…); provider_billing_id = bill_…
-- e, para cartão, a URL do checkout hospedado (para "voltar ao pagamento").
--
-- Nada muda em RLS/grants: `orders` continua sem escrita para anon/authenticated
-- (só service role e fulfill_order/refund_order). fulfill_order/refund_order não
-- mudam: valem para os dois métodos (validam estado, valor e cobrança).
-- =============================================================================

create type public.payment_method as enum ('pix', 'card');
comment on type public.payment_method is
  'Método do pedido de checkout: pix (transparente, QR no site) ou card (checkout hospedado da AbacatePay).';

alter table public.orders
  add column payment_method public.payment_method,
  add column checkout_url text;

comment on column public.orders.payment_method is
  'pix | card. Obrigatório em source=checkout (padrão pix se omitido), nulo em venda manual. Imutável.';
comment on column public.orders.checkout_url is
  'URL do checkout hospedado (https://app.abacatepay.com/pay/bill_...). Só em pedidos de cartão; definida uma única vez.';

-- Backfill: todo pedido de checkout existente é PIX. Sem mexer em updated_at.
alter table public.orders disable trigger orders_set_updated_at;
update public.orders set payment_method = 'pix' where source = 'checkout' and payment_method is null;
alter table public.orders enable trigger orders_set_updated_at;

alter table public.orders
  add constraint orders_payment_method_coherent
    check ((source = 'checkout') = (payment_method is not null)),
  add constraint orders_card_without_pix
    check (payment_method is distinct from 'card' or (pix_br_code is null and pix_br_code_base64 is null)),
  add constraint orders_checkout_url_card_only
    check (
      checkout_url is null
      or (
        payment_method = 'card'
        -- https; http só no loopback (mock dos testes E2E, ADR-021). O host exato
        -- (app.abacatepay.com) é validado no servidor antes de gravar/redirecionar.
        and (checkout_url ~ '^https://' or checkout_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/')
      )
    );

-- Padrão `pix` para pedidos de checkout que não informam o método (compatibilidade
-- com o fluxo PIX existente). Venda manual continua sem método.
create function public.orders_default_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_method is null and new.source = 'checkout' then
    new.payment_method := 'pix';
  end if;
  return new;
end;
$$;

create trigger orders_default_payment_method
  before insert on public.orders
  for each row execute function public.orders_default_payment_method();

revoke all on function public.orders_default_payment_method() from public, anon, authenticated;

-- Imutabilidade: igual a 20261008000002 + payment_method imutável + checkout_url definida uma vez.
create or replace function public.orders_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id        is distinct from old.user_id
  or new.course_id      is distinct from old.course_id
  or new.amount_cents   is distinct from old.amount_cents
  or new.currency       is distinct from old.currency
  or new.source         is distinct from old.source
  or new.provider       is distinct from old.provider
  or new.payment_method is distinct from old.payment_method
  or new.created_by     is distinct from old.created_by
  or new.created_at     is distinct from old.created_at then
    raise exception 'orders: user_id, course_id, amount_cents, currency, source, provider, payment_method, created_by e created_at são imutáveis'
      using errcode = 'check_violation';
  end if;

  if old.provider_billing_id is not null
     and new.provider_billing_id is distinct from old.provider_billing_id then
    raise exception 'orders: provider_billing_id já definido não pode ser alterado'
      using errcode = 'check_violation';
  end if;

  if old.checkout_url is not null
     and new.checkout_url is distinct from old.checkout_url then
    raise exception 'orders: checkout_url já definida não pode ser alterada'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
