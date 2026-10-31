import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/billing-app";

export const Route = createFileRoute("/")({
  component: HomePage,
});
