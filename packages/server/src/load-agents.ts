import { readFile } from "node:fs/promises";
import {
  agentConfigFileSchema,
  type AgentRecord,
  type AgentRepository,
} from "@botanical/core";

/** Upsert agents from a JSON file. Ids are required so restarts do not duplicate rows. */
export async function loadAgentConfigFile(path: string, agents: AgentRepository): Promise<AgentRecord[]> {
  const parsed = agentConfigFileSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  const saved: AgentRecord[] = [];
  for (const config of parsed) {
    const { id, ...patch } = config;
    const existing = await agents.get(id);
    saved.push(existing ? await agents.update(id, patch) : await agents.create(config));
  }
  return saved;
}
