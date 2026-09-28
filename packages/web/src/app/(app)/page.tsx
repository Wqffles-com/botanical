import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/server-api";

export default async function HomePage() {
  // redirect() throws NEXT_REDIRECT, so it must stay outside the try.
  let firstAgentId: string | undefined;
  try {
    const api = await createServerClient();
    const agents = await api.listAgents();
    firstAgentId = agents[0]?.id;
  } catch {
    // Middleware already gated auth. Fall through to the new-agent flow.
  }
  redirect(firstAgentId ? `/agents/${firstAgentId}` : "/agents/new");
}
