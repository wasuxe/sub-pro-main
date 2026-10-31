import { createFileRoute } from "@tanstack/react-router";

import { CustomerPortalPage } from "@/components/billing-app";

export const Route = createFileRoute("/portal")({
  component: CustomerPortalPage,
});
