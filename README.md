# Subpro

Subscription billing workspace built with TanStack Start and Supabase.

## Database setup

Apply `supabase/migrations/20261031000000_billing_setup.sql` to the Supabase project first, then run `supabase/seed.sql` to add three plans, two discount codes, four sample customers, three months of invoices, and payment history. The seed can be run again safely.

The migration intentionally does not install or use `pg_cron`. Invoice generation is exposed as a protected application endpoint and is idempotent per subscription billing period.

After creating a user through sign-up, grant staff access from the Supabase SQL editor by replacing the address below with the staff user's email:

```sql
update public.profiles
set role = 'staff'
where email = 'staff@example.com';
```

Sample customers are data records, not pre-created Auth users. To attach a sample customer to a portal login, sign up using that customer's email after enabling an appropriate email-confirmation method in Supabase Auth.

## Daily invoice generation on Cloudflare

Configure these values in the app/Worker environment (keep service-role and cron secrets private):

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the browser build.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for server-side Supabase access.
- `LOVABLE_CRON_SECRET` as a high-entropy secret available to the app server.
- `APP_BASE_URL` and the same `LOVABLE_CRON_SECRET` as Cloudflare Worker bindings.

Enable the Worker's Cron Trigger for `0 8 * * *` (08:00 UTC daily). The `scheduled` handler in `src/server.ts` posts to `/api/cron/billing` with the bearer secret. That endpoint calls `generate_due_invoices` using the service role. It creates invoices only; it does not attempt to charge customers.

The HTTP endpoint can also be invoked manually with a POST request and `Authorization: Bearer <LOVABLE_CRON_SECRET>`. It returns the number of invoices created. A missing secret or database error is reported as an error response, not treated as a successful run.

## App screens

- `/sign-in` and `/sign-up` use Supabase Auth.
- `/admin` contains the staff overview plus subscriptions, invoices, payments, plans, and discounts.
- `/portal` shows the signed-in customer's subscriptions and invoices.

Database row-level security enforces staff/customer data visibility. New accounts are customers by default; staff role assignment is explicit.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e519b0d9-3d0e-47c4-95f7-b1545b780225).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
bun install
bun run dev
```

Run the app checks with `bun run test`, `bun run lint`, and `bun run build`.
