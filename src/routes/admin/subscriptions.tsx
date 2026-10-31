import { createFileRoute } from "@tanstack/react-router";

import { AdminResourcePage } from "@/components/billing-app";

export const Route = createFileRoute("/admin/subscriptions")({
  component: () => <AdminResourcePage section="subscriptions" />,
});
