import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgePercent,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type AdminRole = Pick<Tables<"profiles">, "role" | "full_name">;
type AdminSection = "subscriptions" | "invoices" | "payments" | "plans" | "discounts";
type DisplayValue = string | number | boolean | null;
type DisplayRow = Record<string, DisplayValue>;

const adminNavigation = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/subscriptions", label: "Subscriptions", icon: ReceiptText },
  { to: "/admin/invoices", label: "Invoices", icon: FileText },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/plans", label: "Plans", icon: Package },
  { to: "/admin/discounts", label: "Discounts", icon: BadgePercent },
];

const sectionDetails: Record<
  AdminSection,
  { title: string; description: string; columns: string[] }
> = {
  subscriptions: {
    title: "Subscriptions",
    description: "Track active plans and upcoming renewals.",
    columns: ["status", "customer_id", "plan_id", "current_period_end", "next_billing_date"],
  },
  invoices: {
    title: "Invoices",
    description: "Review issued invoices and outstanding balances.",
    columns: ["invoice_number", "status", "customer_id", "description", "amount_cents", "due_date"],
  },
  payments: {
    title: "Payments",
    description: "A ledger of recorded payment activity. No payments are collected automatically.",
    columns: ["status", "invoice_id", "amount_cents", "currency", "provider_reference", "paid_at"],
  },
  plans: {
    title: "Plans",
    description: "Review the products available to customers.",
    columns: ["name", "description", "amount_cents", "interval", "is_active"],
  },
  discounts: {
    title: "Discounts",
    description: "Manage promotional codes and redemption limits.",
    columns: ["code", "description", "percent_off", "valid_until", "redemption_count", "is_active"],
  },
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function display(value: DisplayValue, key: string, row: DisplayRow) {
  if (value === null || value === "") return "—";
  if (key === "amount_cents") return money(Number(value), String(row.currency ?? "USD"));
  if (
    ["current_period_end", "next_billing_date", "due_date", "valid_until", "paid_at"].includes(key)
  ) {
    return dateLabel(String(value));
  }
  if (key === "is_active") return value ? "Active" : "Inactive";
  if (key === "percent_off") return `${value}%`;
  if (typeof value === "string" && value.length > 22) return `${value.slice(0, 8)}…`;
  return String(value);
}

export function AdminLayout() {
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadRole() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (active) setError(userError.message);
        setLoading(false);
        return;
      }
      if (!userData.user) {
        setLoading(false);
        return;
      }
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (active) {
        if (profileError) setError(profileError.message);
        else setRole(data);
        setLoading(false);
      }
    }
    void loadRole();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <CenteredMessage>Loading your workspace…</CenteredMessage>;
  if (error) return <CenteredMessage title="Couldn't load your account">{error}</CenteredMessage>;
  if (!role) {
    return (
      <CenteredMessage title="Sign in to continue">
        <Link className="button button-primary" to="/sign-in">
          Sign in
        </Link>
      </CenteredMessage>
    );
  }
  if (role.role !== "staff") {
    return (
      <CenteredMessage title="Staff access required">
        <Link className="button button-primary" to="/portal">
          Go to your customer portal
        </Link>
      </CenteredMessage>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">s</span> subpro
        </Link>
        <p className="sidebar-caption">WORKSPACE</p>
        <nav className="sidebar-nav">
          {adminNavigation.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="sidebar-link">
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip">
            <span className="avatar">{(role.full_name || "S").slice(0, 1).toUpperCase()}</span>
            <span>{role.full_name || "Staff account"}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <span>Billing workspace</span>
          <Link to="/portal" className="quiet-link">
            Customer portal <ArrowUpRight size={14} />
          </Link>
        </header>
        <Outlet />
      </main>
    </div>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<{
    customers: number;
    subscriptions: number;
    openInvoices: number;
    paidCents: number;
  }>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadStats() {
      const [customers, subscriptions, invoices, payments] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("payments").select("amount_cents").eq("status", "succeeded"),
      ]);
      const failure = customers.error ?? subscriptions.error ?? invoices.error ?? payments.error;
      if (failure) {
        if (active) setError(failure.message);
        return;
      }
      if (active) {
        setStats({
          customers: customers.count ?? 0,
          subscriptions: subscriptions.count ?? 0,
          openInvoices: invoices.count ?? 0,
          paidCents: (payments.data ?? []).reduce(
            (total, payment) => total + payment.amount_cents,
            0,
          ),
        });
      }
    }
    void loadStats();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Good morning</h1>
          <p className="muted">Here’s what’s happening with your subscriptions.</p>
        </div>
        <Link to="/admin/invoices" className="button button-primary">
          <FileText size={16} /> View invoices
        </Link>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <div className="stats-grid">
        <StatCard
          label="Total customers"
          value={stats?.customers}
          icon={<Users />}
          hint="Accounts in your workspace"
        />
        <StatCard
          label="Active subscriptions"
          value={stats?.subscriptions}
          icon={<ReceiptText />}
          hint="Currently renewing"
        />
        <StatCard
          label="Open invoices"
          value={stats?.openInvoices}
          icon={<ArrowDownLeft />}
          hint="Awaiting payment"
        />
        <StatCard
          label="Payments recorded"
          value={stats ? money(stats.paidCents) : undefined}
          icon={<CreditCard />}
          hint="Successful recorded payments"
        />
      </div>
      <div className="welcome-panel">
        <div>
          <p className="eyebrow">DAILY BILLING</p>
          <h2>Invoice generation is ready</h2>
          <p className="muted">
            The protected billing endpoint creates invoices for due subscriptions. Payments are
            never charged automatically.
          </p>
        </div>
        <span className="status-pill status-active">Invoices only</span>
      </div>
      <div className="quick-links">
        <QuickLink
          href="/admin/subscriptions"
          icon={<ReceiptText />}
          title="Subscriptions"
          text="See plans and upcoming renewals"
        />
        <QuickLink
          href="/admin/plans"
          icon={<Package />}
          title="Plans"
          text="Review your pricing catalog"
        />
        <QuickLink
          href="/admin/discounts"
          icon={<BadgePercent />}
          title="Discounts"
          text="Check active promotional codes"
        />
      </div>
    </section>
  );
}

export function AdminResourcePage({ section }: { section: AdminSection }) {
  const details = sectionDetails[section];
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadRows() {
      const result = await readResource(section);
      if (!active) return;
      if (result.error) setError(result.error);
      else setRows(result.rows);
      setLoading(false);
    }
    void loadRows();
    return () => {
      active = false;
    };
  }, [section]);

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MANAGE</p>
          <h1>{details.title}</h1>
          <p className="muted">{details.description}</p>
        </div>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <div className="table-card">
        {loading ? (
          <p className="empty-state">Loading {details.title.toLowerCase()}…</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">
            No records yet. Apply the database seed to load sample data.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {details.columns.map((column) => (
                    <th key={column}>{column.replaceAll("_", " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={String(row.id ?? index)}>
                    {details.columns.map((column) => (
                      <td key={column}>{display(row[column] ?? null, column, row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="table-footnote">
        Showing the latest 50 records. All values are read live from your Supabase database.
      </p>
    </section>
  );
}

async function readResource(
  section: AdminSection,
): Promise<{ rows: DisplayRow[]; error: string | null }> {
  switch (section) {
    case "subscriptions": {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return { rows: (data ?? []).map(toDisplayRow), error: error?.message ?? null };
    }
    case "invoices": {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return { rows: (data ?? []).map(toDisplayRow), error: error?.message ?? null };
    }
    case "payments": {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return { rows: (data ?? []).map(toDisplayRow), error: error?.message ?? null };
    }
    case "plans": {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return { rows: (data ?? []).map(toDisplayRow), error: error?.message ?? null };
    }
    case "discounts": {
      const { data, error } = await supabase
        .from("discounts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return { rows: (data ?? []).map(toDisplayRow), error: error?.message ?? null };
    }
  }
}

function toDisplayRow(value: object): DisplayRow {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        ? item
        : null,
    ]),
  ) as DisplayRow;
}

export function CustomerPortalPage() {
  const [customer, setCustomer] = useState<Tables<"customers"> | null>(null);
  const [subscriptions, setSubscriptions] = useState<Tables<"subscriptions">[]>([]);
  const [invoices, setInvoices] = useState<Tables<"invoices">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadPortal() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (active) {
          setError(authError?.message ?? "Sign in to view your account.");
          setLoading(false);
        }
        return;
      }
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("*")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (customerError || !customerData) {
        if (active) {
          setError(
            customerError?.message ?? "No customer profile is connected to this account yet.",
          );
          setLoading(false);
        }
        return;
      }
      const [subscriptionsResult, invoicesResult] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("*")
          .eq("customer_id", customerData.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("invoices")
          .select("*")
          .eq("customer_id", customerData.id)
          .order("created_at", { ascending: false }),
      ]);
      if (active) {
        setCustomer(customerData);
        if (subscriptionsResult.error || invoicesResult.error)
          setError(
            (subscriptionsResult.error ?? invoicesResult.error)?.message ??
              "Unable to load account details.",
          );
        else {
          setSubscriptions(subscriptionsResult.data ?? []);
          setInvoices(invoicesResult.data ?? []);
        }
        setLoading(false);
      }
    }
    void loadPortal();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <CenteredMessage>Loading your account…</CenteredMessage>;
  if (error)
    return (
      <CenteredMessage title="Your portal">
        {error}
        <Link className="button button-primary" to="/sign-in">
          Sign in
        </Link>
      </CenteredMessage>
    );

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">s</span> subpro
        </Link>
        <SignOutButton />
      </header>
      <main className="portal-content">
        <p className="eyebrow">CUSTOMER PORTAL</p>
        <h1>Welcome back, {customer?.name.split(" ")[0]}</h1>
        <p className="muted">Manage your subscription and keep track of invoices.</p>
        <section className="portal-section">
          <div className="section-title">
            <h2>Your subscriptions</h2>
            <span>{subscriptions.length} total</span>
          </div>
          {subscriptions.length === 0 ? (
            <p className="empty-state">You don’t have any subscriptions yet.</p>
          ) : (
            <div className="portal-list">
              {subscriptions.map((subscription) => (
                <article className="portal-row" key={subscription.id}>
                  <div>
                    <strong>
                      {subscription.status === "active" ? "Active subscription" : "Subscription"}
                    </strong>
                    <p className="muted">Renews {dateLabel(subscription.current_period_end)}</p>
                  </div>
                  <span className={`status-pill status-${subscription.status}`}>
                    {subscription.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="portal-section">
          <div className="section-title">
            <h2>Recent invoices</h2>
            <span>{invoices.length} total</span>
          </div>
          {invoices.length === 0 ? (
            <p className="empty-state">Your invoices will appear here.</p>
          ) : (
            <div className="portal-list">
              {invoices.map((invoice) => (
                <article className="portal-row" key={invoice.id}>
                  <div>
                    <strong>{invoice.invoice_number}</strong>
                    <p className="muted">
                      {invoice.description} · Due {dateLabel(invoice.due_date)}
                    </p>
                  </div>
                  <div className="invoice-total">
                    {money(invoice.amount_cents, invoice.currency)}{" "}
                    <span className={`status-pill status-${invoice.status}`}>{invoice.status}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const isSignup = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    if (isSignup) {
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/portal` },
      });
      if (signupError) setError(signupError.message);
      else if (data.session) window.location.assign("/portal");
      else setSuccess("Account created.");
    } else {
      const { error: signinError } = await supabase.auth.signInWithPassword({ email, password });
      if (signinError) setError(signinError.message);
      else {
        const { data: userData } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userData.user?.id ?? "")
          .maybeSingle();
        window.location.assign(profile?.role === "staff" ? "/admin" : "/portal");
      }
    }
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <div className="auth-decoration">
        <div className="auth-glow" />
        <div className="auth-copy">
          <Link to="/" className="brand brand-light">
            <span className="brand-mark">s</span> subpro
          </Link>
          <p className="eyebrow">BILLING, SIMPLIFIED</p>
          <h2>Good business runs on good relationships.</h2>
          <p>Keep subscriptions, invoices, and customer records in one thoughtful workspace.</p>
          <div className="auth-decoration-card">
            <span className="mini-chart">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              <b>Everything in one place</b>
              <small>Your billing overview, at a glance.</small>
            </span>
            <ArrowUpRight size={17} />
          </div>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-form-wrap">
          <Link to="/" className="brand mobile-brand">
            <span className="brand-mark">s</span> subpro
          </Link>
          <p className="eyebrow">{isSignup ? "GET STARTED" : "WELCOME BACK"}</p>
          <h1>{isSignup ? "Create your account" : "Sign in to Subpro"}</h1>
          <p className="muted">
            {isSignup
              ? "Create a customer account to access your portal."
              : "Enter your details to access your workspace."}
          </p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {isSignup && (
              <label>
                Full name
                <input
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            {error && <InlineError>{error}</InlineError>}
            {success && <p className="success-message">{success}</p>}
            <button className="button button-primary button-wide" disabled={busy}>
              {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}{" "}
              <ArrowUpRight size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {isSignup ? "Already have an account?" : "New to Subpro?"}{" "}
            <Link to={isSignup ? "/sign-in" : "/sign-up"}>
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export function HomePage() {
  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <Link to="/" className="brand">
          <span className="brand-mark">s</span> subpro
        </Link>
        <nav>
          <a href="#features">Product</a>
          <Link to="/sign-in">Sign in</Link>
          <Link className="button button-primary nav-cta" to="/sign-up">
            Get started <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-dot" /> SUBSCRIPTION BILLING, MADE SIMPLE
          </p>
          <h1>
            More clarity.
            <br />
            <span>Less busywork.</span>
          </h1>
          <p className="hero-description">
            A calmer way to manage recurring revenue. Bring your plans, customers, and invoices
            together in one place.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/sign-up">
              Start your workspace <ArrowUpRight size={16} />
            </Link>
            <Link className="text-link" to="/sign-in">
              Already a member? Sign in
            </Link>
          </div>
          <div className="hero-note">
            <span className="avatar avatar-small">✓</span> Simple, transparent billing for your
            business
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="mock-window">
            <div className="mock-top">
              <span className="mock-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Revenue overview</span>
              <span>•••</span>
            </div>
            <div className="mock-body">
              <div className="mock-greeting">
                <div>
                  <small>MONDAY, OCTOBER 26</small>
                  <b>Your business at a glance</b>
                </div>
                <span className="mock-filter">Last 30 days⌄</span>
              </div>
              <div className="mock-stat-grid">
                <div className="mock-stat">
                  <small>MONTHLY REVENUE</small>
                  <b>
                    $24,680 <span>↗ 12.8%</span>
                  </b>
                </div>
                <div className="mock-stat">
                  <small>ACTIVE PLANS</small>
                  <b>
                    184 <span>↗ 8.2%</span>
                  </b>
                </div>
              </div>
              <div className="chart-area">
                <div className="chart-y">
                  <span>$30k</span>
                  <span>$20k</span>
                  <span>$10k</span>
                  <span>$0</span>
                </div>
                <div className="chart-lines">
                  <i />
                  <i />
                  <i />
                  <svg
                    viewBox="0 0 420 150"
                    preserveAspectRatio="none"
                    aria-label="Revenue trend line"
                  >
                    <path d="M0 123 C35 112 42 100 74 105 S112 82 140 92 S176 67 210 75 S240 44 277 59 S314 24 346 43 S390 18 420 8" />
                  </svg>
                  <div className="chart-x">
                    <span>Oct 1</span>
                    <span>Oct 8</span>
                    <span>Oct 15</span>
                    <span>Oct 22</span>
                    <span>Oct 30</span>
                  </div>
                </div>
              </div>
              <div className="mock-invoice">
                <span className="invoice-icon">
                  <FileText size={15} />
                </span>
                <span>
                  <b>Invoice #INV-2048</b>
                  <small>Northstar Studio · just now</small>
                </span>
                <strong>$490.00</strong>
                <span className="status-pill status-paid">Paid</span>
              </div>
            </div>
          </div>
          <div className="floating-badge">
            <span className="badge-icon">
              <ArrowDownLeft size={15} />
            </span>
            <span>
              <small>Invoices created</small>
              <b>Everything on track</b>
            </span>
          </div>
        </div>
      </section>
      <section className="feature-strip" id="features">
        <div>
          <span className="feature-number">01</span>
          <b>Recurring revenue</b>
          <p>Know what’s renewing and when.</p>
        </div>
        <div>
          <span className="feature-number">02</span>
          <b>Invoices in view</b>
          <p>Keep every billing detail close.</p>
        </div>
        <div>
          <span className="feature-number">03</span>
          <b>Customer first</b>
          <p>A clear portal for your customers.</p>
        </div>
      </section>
      <footer className="marketing-footer">
        <Link to="/" className="brand">
          <span className="brand-mark">s</span> subpro
        </Link>
        <span>Thoughtful tools for recurring business.</span>
        <Link to="/portal">
          Customer portal <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}

function SignOutButton() {
  return (
    <button
      className="signout-button"
      onClick={() =>
        void supabase.auth.signOut().then(({ error }) => {
          if (error) console.error("Could not sign out:", error.message);
          else window.location.assign("/");
        })
      }
    >
      <LogOut size={15} /> Sign out
    </button>
  );
}

function CenteredMessage({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <main className="centered-message">
      <div className="centered-card">
        <Link to="/" className="brand">
          <span className="brand-mark">s</span> subpro
        </Link>
        {title && <h1>{title}</h1>}
        <div>{children}</div>
      </div>
    </main>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="inline-error" role="alert">
      {children}
    </p>
  );
}

function StatCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value?: string | number;
  icon: ReactNode;
  hint: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value ?? "—"}</strong>
      <small>{hint}</small>
    </article>
  );
}

function QuickLink({
  href,
  icon,
  title,
  text,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <a className="quick-link" href={href}>
      <span className="quick-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <ArrowUpRight size={15} />
    </a>
  );
}
