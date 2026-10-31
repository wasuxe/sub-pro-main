insert into public.plans (id, name, description, amount_cents, currency, interval, is_active)
values
  ('10000000-0000-4000-8000-000000000001', 'Starter', 'For individuals getting started.', 1900, 'USD', 'month', true),
  ('10000000-0000-4000-8000-000000000002', 'Growth', 'Tools for growing teams.', 4900, 'USD', 'month', true),
  ('10000000-0000-4000-8000-000000000003', 'Scale', 'Advanced features for larger teams.', 9900, 'USD', 'month', true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  interval = excluded.interval,
  is_active = excluded.is_active;

insert into public.discounts (id, code, description, percent_off, valid_from, valid_until, max_redemptions, redemption_count, is_active)
values
  ('20000000-0000-4000-8000-000000000001', 'WELCOME20', '20% off the first three months.', 20, current_date - 90, current_date + 90, 100, 8, true),
  ('20000000-0000-4000-8000-000000000002', 'ANNUAL10', '10% off an annual plan.', 10, current_date - 30, current_date + 335, 50, 12, true)
on conflict (id) do update set
  code = excluded.code,
  description = excluded.description,
  percent_off = excluded.percent_off,
  valid_from = excluded.valid_from,
  valid_until = excluded.valid_until,
  max_redemptions = excluded.max_redemptions,
  redemption_count = excluded.redemption_count,
  is_active = excluded.is_active;

insert into public.customers (id, name, email, company)
values
  ('30000000-0000-4000-8000-000000000001', 'Olivia Chen', 'olivia.chen@example.test', 'Northstar Studio'),
  ('30000000-0000-4000-8000-000000000002', 'Mateo Rivera', 'mateo.rivera@example.test', 'Rivera Works'),
  ('30000000-0000-4000-8000-000000000003', 'Amara Okafor', 'amara.okafor@example.test', 'Brightpath'),
  ('30000000-0000-4000-8000-000000000004', 'Noah Williams', 'noah.williams@example.test', 'Fieldnote')
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  company = excluded.company;

insert into public.subscriptions (
  id, customer_id, plan_id, discount_id, status,
  current_period_start, current_period_end, next_billing_date
)
values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'active', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '1 month')::date),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', null, 'active', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '1 month')::date),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', null, 'active', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '1 month')::date),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', null, 'canceled', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '1 month')::date)
on conflict (id) do update set
  customer_id = excluded.customer_id,
  plan_id = excluded.plan_id,
  discount_id = excluded.discount_id,
  status = excluded.status,
  current_period_start = excluded.current_period_start,
  current_period_end = excluded.current_period_end,
  next_billing_date = excluded.next_billing_date;

with invoice_seed as (
  select
    md5(s.id::text || ':' || month_offset::text)::uuid as id,
    'DEMO-' || right(s.id::text, 4) || '-' || to_char((date_trunc('month', current_date) - make_interval(months => month_offset))::date, 'YYYYMM') as invoice_number,
    s.customer_id,
    s.id as subscription_id,
    p.name || ' subscription' as description,
    case when s.discount_id is null then p.amount_cents else round(p.amount_cents * (100 - d.percent_off)::numeric / 100)::integer end as amount_cents,
    p.currency,
    (date_trunc('month', current_date) - make_interval(months => month_offset))::date as period_start,
    (date_trunc('month', current_date) - make_interval(months => month_offset - 1))::date as period_end,
    (date_trunc('month', current_date) - make_interval(months => month_offset))::date as due_date,
    case when month_offset = 1 then 'open' else 'paid' end as status,
    month_offset
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  left join public.discounts d on d.id = s.discount_id
  cross join generate_series(1, 3) as months(month_offset)
)
insert into public.invoices (
  id, invoice_number, customer_id, subscription_id, description, amount_cents,
  currency, period_start, period_end, due_date, status
)
select
  id, invoice_number, customer_id, subscription_id, description, amount_cents,
  currency, period_start, period_end, due_date, status
from invoice_seed
on conflict (subscription_id, period_start) do update set
  description = excluded.description,
  amount_cents = excluded.amount_cents,
  status = excluded.status,
  due_date = excluded.due_date;

insert into public.payments (id, invoice_id, amount_cents, currency, status, provider_reference, paid_at)
select
  md5(i.id::text || ':payment')::uuid,
  i.id,
  i.amount_cents,
  i.currency,
  'succeeded',
  'demo-' || right(i.invoice_number, 9),
  i.due_date::timestamptz
from public.invoices i
where i.status = 'paid'
  and i.invoice_number like 'DEMO-%'
on conflict (id) do update set
  invoice_id = excluded.invoice_id,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  status = excluded.status,
  provider_reference = excluded.provider_reference,
  paid_at = excluded.paid_at;
