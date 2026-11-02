-- 14 — pedidos de cartão (checkout hospedado, PAY-007 / ADR-022)
begin;
select plan(27);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'aluno@test', '{"full_name":"Aluno"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outro@test', '{"full_name":"Outro"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin');

insert into public.courses (id, slug, title, status, price_cents)
  values ('00000000-0000-0000-0000-0000000000c1', 'curso-card', 'Curso Cartão', 'published', 4990);

-- o1: cartão pendente do aluno · o2: PIX sem método explícito (padrão) · o3: cartão do outro aluno
insert into public.orders (id, user_id, course_id, amount_cents, payment_method, provider_billing_id, checkout_url, expires_at) values
  ('60000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 4990, 'card', 'bill_a1', 'https://app.abacatepay.com/pay/bill_a1', now() + interval '1 hour');
insert into public.orders (id, user_id, course_id, amount_cents, status) values
  ('60000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 4990, 'expired');
insert into public.orders (id, user_id, course_id, amount_cents, payment_method, provider_billing_id, checkout_url) values
  ('60000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 4990, 'card', 'bill_a3', 'https://app.abacatepay.com/pay/bill_a3');
insert into public.payment_events (provider_event_id, event_type, payload) values
  ('evt_card_paid', 'checkout.completed', '{}'),
  ('evt_card_refund', 'checkout.refunded', '{}');

create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.affected(text) to public;

-- estrutura
select has_type('public', 'payment_method', 'enum payment_method existe');
select enum_has_labels('public', 'payment_method', array['pix', 'card'], 'payment_method = pix | card');
select has_column('public', 'orders', 'payment_method', 'orders.payment_method existe');
select has_column('public', 'orders', 'checkout_url', 'orders.checkout_url existe');
select is((select payment_method::text from public.orders where id = '60000000-0000-0000-0000-0000000000a2'),
  'pix', 'checkout sem método informado vira pix (padrão)');

-- coerência
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, payment_method, pix_br_code)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 4990, 'card', 'x')$$,
  '23514', null, 'cartão não tem copia-e-cola PIX');
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, payment_method, checkout_url, status)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 4990, 'pix', 'https://app.abacatepay.com/pay/x', 'failed')$$,
  '23514', null, 'checkout_url só em pedido de cartão');
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, payment_method, checkout_url, status)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 4990, 'card', 'http://evil.test/pay', 'failed')$$,
  '23514', null, 'checkout_url precisa ser https');
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, source, provider, created_by, payment_method, status, paid_at)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 4990, 'manual', 'manual', '00000000-0000-0000-0000-00000000000a', 'card', 'paid', now())$$,
  '23514', null, 'venda manual não tem método de pagamento');

-- imutabilidade
select throws_ok($$update public.orders set payment_method = 'pix' where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'payment_method é imutável');
select throws_ok($$update public.orders set checkout_url = 'https://app.abacatepay.com/pay/outro' where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'checkout_url definida não pode ser trocada');

-- anon: não lê nem escreve
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok($$select count(*) from public.orders$$, '42501', null, 'anon: não lê pedidos');
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, payment_method)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 1, 'card')$$,
  '42501', null, 'anon: INSERT orders negado');

-- aluno: lê só os próprios (com método e URL), não escreve, não chama as funções de pagamento
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
set local role authenticated;
select is((select payment_method::text || ' ' || checkout_url from public.orders where id = '60000000-0000-0000-0000-0000000000a1'),
  'card https://app.abacatepay.com/pay/bill_a1', 'aluno: lê método e URL do próprio pedido');
select is((select count(*) from public.orders where id = '60000000-0000-0000-0000-0000000000a3'),
  0::bigint, 'aluno: não lê pedido de cartão de outro aluno');
select throws_ok($$insert into public.orders (user_id, course_id, amount_cents, payment_method)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 1, 'card')$$,
  '42501', null, 'aluno: INSERT orders negado');
select throws_ok($$update public.orders set checkout_url = 'https://evil.test' where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'aluno: UPDATE orders negado');
select throws_ok($$select public.fulfill_order('60000000-0000-0000-0000-0000000000a1', 'bill_a1', 4990)$$,
  '42501', null, 'aluno: não chama fulfill_order');

-- admin: lê todos, mas também não escreve direto nem chama as funções
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.orders where payment_method = 'card'), 2::bigint, 'admin: lê pedidos de cartão de todos');
select throws_ok($$update public.orders set status = 'paid' where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'admin: UPDATE orders direto negado');
select throws_ok($$select public.refund_order('60000000-0000-0000-0000-0000000000a1', null)$$,
  '42501', null, 'admin: não chama refund_order');

-- service role (webhook): fulfill/refund idempotentes também para cartão
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select is(public.fulfill_order('60000000-0000-0000-0000-0000000000a1', 'bill_a1', 1000, 'evt_card_paid'),
  'amount_mismatch', 'cartão: valor diferente do pedido não libera');
select is(public.fulfill_order('60000000-0000-0000-0000-0000000000a1', 'bill_outro', 4990, 'evt_card_paid'),
  'billing_mismatch', 'cartão: outro checkout não libera');
select is(public.fulfill_order('60000000-0000-0000-0000-0000000000a1', 'bill_a1', 4990, 'evt_card_paid'),
  'fulfilled', 'cartão: pending -> paid + matrícula');
select is(public.fulfill_order('60000000-0000-0000-0000-0000000000a1', 'bill_a1', 4990, 'evt_card_paid'),
  'already_paid', 'cartão: reentrega é idempotente');
select is(public.refund_order('60000000-0000-0000-0000-0000000000a1', 'evt_card_refund'),
  'refunded', 'cartão: paid -> refunded');
select is((select count(*) from public.enrollments
   where order_id = '60000000-0000-0000-0000-0000000000a1' and revoked_at is null),
  0::bigint, 'cartão: reembolso revoga a matrícula da compra');

select * from finish();
rollback;
