create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'customer' check (role in ('customer', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles (id) on delete set null,
  name text not null,
  email text not null unique,
  company text,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  interval text not null check (interval in ('month', 'year')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  percent_off smallint not null check (percent_off between 1 and 100),
  valid_from date,
  valid_until date,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  discount_id uuid references public.discounts (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due')),
  current_period_start date not null,
  current_period_end date not null,
  next_billing_date date not null,
  created_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid not null references public.customers (id),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_start),
  check (period_end > period_start)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('succeeded', 'failed', 'refunded')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'staff'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_name text;
begin
  customer_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, customer_name)
  on conflict (id) do update set email = excluded.email;

  insert into public.customers (user_id, name, email)
  values (new.id, customer_name, new.email)
  on conflict (email) do update set user_id = excluded.user_id, name = excluded.name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.generate_due_invoices(p_run_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  due_subscription record;
  invoice_total integer;
  created_count integer := 0;
  billing_next_date date;
  billing_period_start date;
  billing_period_end date;
  next_period_end date;
begin
  for due_subscription in
    select s.id, s.customer_id, s.plan_id, s.discount_id,
           s.current_period_start, s.current_period_end, s.next_billing_date,
           p.name as plan_name, p.amount_cents, p.currency, p.interval,
           d.percent_off
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    left join public.discounts d
      on d.id = s.discount_id
      and d.is_active
      and (d.valid_from is null or d.valid_from <= p_run_date)
      and (d.valid_until is null or d.valid_until >= p_run_date)
      and (d.max_redemptions is null or d.redemption_count < d.max_redemptions)
    where s.status = 'active'
      and s.next_billing_date <= p_run_date
      and p.is_active
    order by s.next_billing_date, s.id
    for update of s
  loop
    billing_period_start := due_subscription.current_period_start;
    billing_period_end := due_subscription.current_period_end;
    billing_next_date := due_subscription.next_billing_date;

    while billing_next_date <= p_run_date loop
      next_period_end := case due_subscription.interval
        when 'year' then (billing_period_end + interval '1 year')::date
        else (billing_period_end + interval '1 month')::date
      end;

      invoice_total := due_subscription.amount_cents;
      if due_subscription.percent_off is not null then
        invoice_total := round(
          invoice_total * (100 - due_subscription.percent_off)::numeric / 100
        )::integer;
      end if;

      insert into public.invoices (
        invoice_number, customer_id, subscription_id, description,
        amount_cents, currency, period_start, period_end, due_date
      )
      values (
        'INV-' || to_char(billing_next_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
        due_subscription.customer_id,
        due_subscription.id,
        due_subscription.plan_name || ' subscription',
        invoice_total,
        due_subscription.currency,
        billing_period_end,
        next_period_end,
        billing_next_date
      )
      on conflict (subscription_id, period_start) do nothing;

      if found then
        created_count := created_count + 1;
      end if;

      billing_period_start := billing_period_end;
      billing_period_end := next_period_end;
      billing_next_date := next_period_end;
    end loop;

    update public.subscriptions
    set current_period_start = billing_period_start,
        current_period_end = billing_period_end,
        next_billing_date = billing_next_date
    where id = due_subscription.id;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.generate_due_invoices(date) from public, anon, authenticated;
grant execute on function public.generate_due_invoices(date) to service_role;
revoke all on function public.is_staff() from public, anon, authenticated;
grant execute on function public.is_staff() to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.plans enable row level security;
alter table public.discounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

drop policy if exists "Profiles are visible to their owner or staff" on public.profiles;
create policy "Profiles are visible to their owner or staff"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
drop policy if exists "Users can update their own customer profile" on public.profiles;
create policy "Users can update their own customer profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = 'customer');

drop policy if exists "Customers are visible to their owner or staff" on public.customers;
create policy "Customers are visible to their owner or staff"
  on public.customers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop policy if exists "Customers can update their own details" on public.customers;
create policy "Customers can update their own details"
  on public.customers for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Active plans are visible to everyone" on public.plans;
create policy "Active plans are visible to everyone"
  on public.plans for select to anon, authenticated
  using (is_active);
drop policy if exists "Staff can manage plans" on public.plans;
create policy "Staff can manage plans"
  on public.plans for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists "Active discounts are visible to everyone" on public.discounts;
create policy "Active discounts are visible to everyone"
  on public.discounts for select to anon, authenticated
  using (is_active);
drop policy if exists "Staff can manage discounts" on public.discounts;
create policy "Staff can manage discounts"
  on public.discounts for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists "Subscriptions are visible to their owner or staff" on public.subscriptions;
create policy "Subscriptions are visible to their owner or staff"
  on public.subscriptions for select to authenticated
  using (
    (select public.is_staff()) or exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = (select auth.uid())
    )
  );
drop policy if exists "Staff can manage subscriptions" on public.subscriptions;
create policy "Staff can manage subscriptions"
  on public.subscriptions for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists "Invoices are visible to their owner or staff" on public.invoices;
create policy "Invoices are visible to their owner or staff"
  on public.invoices for select to authenticated
  using (
    (select public.is_staff()) or exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = (select auth.uid())
    )
  );
drop policy if exists "Staff can manage invoices" on public.invoices;
create policy "Staff can manage invoices"
  on public.invoices for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

drop policy if exists "Payments are visible to their owner or staff" on public.payments;
create policy "Payments are visible to their owner or staff"
  on public.payments for select to authenticated
  using (
    (select public.is_staff()) or exists (
      select 1
      from public.invoices i
      join public.customers c on c.id = i.customer_id
      where i.id = invoice_id and c.user_id = (select auth.uid())
    )
  );
drop policy if exists "Staff can manage payments" on public.payments;
create policy "Staff can manage payments"
  on public.payments for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

notify pgrst, 'reload schema';
