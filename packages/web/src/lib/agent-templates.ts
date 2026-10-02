import type { AgentExport } from "./agent-export";
import coder from "./agent-templates/coder.json";
import dailyBriefing from "./agent-templates/daily-briefing.json";
import inboxTriage from "./agent-templates/inbox-triage.json";
import researcher from "./agent-templates/researcher.json";
import writer from "./agent-templates/writer.json";

/** Starter agents for the new-agent form. Plain JSON in the agent export format. */
export const AGENT_TEMPLATES: { id: string; file: AgentExport }[] = [
  { id: "researcher", file: researcher },
  { id: "coder", file: coder },
  { id: "daily-briefing", file: dailyBriefing },
  { id: "inbox-triage", file: inboxTriage },
  { id: "writer", file: writer },
] as { id: string; file: AgentExport }[];
