import { createFileRoute } from "@tanstack/react-router";

import { AdminLayout } from "@/components/billing-app";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});
