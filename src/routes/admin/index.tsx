import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/components/billing-app";

export const Route = createFileRoute("/admin/")({
  component: DashboardPage,
});
