import { createFileRoute } from "@tanstack/react-router";

import { AdminResourcePage } from "@/components/billing-app";

export const Route = createFileRoute("/admin/invoices")({
  component: () => <AdminResourcePage section="invoices" />,
});
