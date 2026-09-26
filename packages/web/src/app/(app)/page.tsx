import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/server-api";

export default async function HomePage() {
  try {
    const api = await createServerClient();
    const agents = await api.listAgents();
    if (agents[0]) {
      redirect(`/agents/${agents[0].id}`);
    }
  } catch {
    // Middleware already gated auth. Fall through to the new-agent flow.
  }
  redirect("/agents/new");
}
