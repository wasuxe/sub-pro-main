import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type CloudflareEnv = {
  APP_BASE_URL?: string;
  LOVABLE_CRON_SECRET?: string;
};

type CloudflareExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
  scheduled(
    _event: { cron: string; scheduledTime: number },
    env: CloudflareEnv,
    ctx: CloudflareExecutionContext,
  ) {
    ctx.waitUntil(triggerDailyBilling(env));
  },
};

async function triggerDailyBilling(env: CloudflareEnv): Promise<void> {
  if (!env.APP_BASE_URL || !env.LOVABLE_CRON_SECRET) {
    throw new Error(
      "Cloudflare billing cron requires APP_BASE_URL and LOVABLE_CRON_SECRET bindings",
    );
  }

  const endpoint = new URL("/api/cron/billing", env.APP_BASE_URL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${env.LOVABLE_CRON_SECRET}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily billing request failed (${response.status}): ${body}`);
  }

  console.info("Daily billing invoices generated:", await response.text());
}
