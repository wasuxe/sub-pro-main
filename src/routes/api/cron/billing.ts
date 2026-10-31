import { createFileRoute } from "@tanstack/react-router";

async function matchesSecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export const Route = createFileRoute("/api/cron/billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["LOVABLE_CRON_SECRET"];
        if (!secret) {
          console.error("[billing cron] LOVABLE_CRON_SECRET is not configured");
          return Response.json({ error: "Billing scheduler is not configured" }, { status: 500 });
        }

        const authorization = request.headers.get("authorization") ?? "";
        const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!(await matchesSecret(provided, secret))) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("generate_due_invoices", {
          p_run_date: new Date().toISOString().slice(0, 10),
        });
        if (error) {
          console.error("[billing cron] Invoice generation failed:", error.message);
          return Response.json({ error: "Invoice generation failed" }, { status: 500 });
        }

        return Response.json({ created: data });
      },
    },
  },
});
