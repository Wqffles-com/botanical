import type { UsageEvent } from "../types.ts";
import { estimateCostUsd, priceFor, type ModelPrice } from "./prices.ts";

export interface UsageRow {
  key: string;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when no call in the row has a price. */
  costUsd: number | null;
  /** Calls whose model has no price, so the cost above leaves them out. */
  unpricedCalls: number;
}

export interface UsageReport {
  since: string;
  until: string;
  totals: UsageRow;
  byDay: UsageRow[];
  byAgent: UsageRow[];
  byModel: UsageRow[];
  bySource: UsageRow[];
  byUser: UsageRow[];
}

export interface ReportNames {
  agents: ReadonlyMap<string, string>;
  profiles: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
}

type Grouper = (event: UsageEvent) => { key: string; label: string };

function emptyRow(key: string, label: string): UsageRow {
  return { key, label, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, unpricedCalls: 0 };
}

export function buildUsageReport(
  events: readonly UsageEvent[],
  range: { since: string; until: string },
  overrides: Readonly<Record<string, ModelPrice>>,
  names: ReportNames,
): UsageReport {
  const totals = emptyRow("total", "Total");
  const groups = {
    day: new Map<string, UsageRow>(),
    agent: new Map<string, UsageRow>(),
    model: new Map<string, UsageRow>(),
    source: new Map<string, UsageRow>(),
    user: new Map<string, UsageRow>(),
  };
  const groupers: Record<keyof typeof groups, Grouper> = {
    day: (event) => ({ key: event.createdAt.slice(0, 10), label: event.createdAt.slice(0, 10) }),
    agent: (event) => ({
      key: event.agentId ?? "none",
      label: event.agentId ? (names.agents.get(event.agentId) ?? "Deleted agent") : "No agent",
    }),
    model: (event) => ({
      key: `${event.profileId ?? ""}|${event.model}`,
      label: event.profileId ? `${names.profiles.get(event.profileId) ?? event.profileId} · ${event.model}` : event.model,
    }),
    source: (event) => ({ key: event.source, label: SOURCE_LABELS[event.source] }),
    user: (event) => ({ key: event.userId, label: names.users.get(event.userId) ?? "Unknown user" }),
  };

  const add = (row: UsageRow, event: UsageEvent, cost: number | null) => {
    row.calls += 1;
    row.inputTokens += event.inputTokens;
    row.outputTokens += event.outputTokens;
    if (cost === null) row.unpricedCalls += 1;
    else row.costUsd = (row.costUsd ?? 0) + cost;
  };

  for (const event of events) {
    const cost = estimateCostUsd(event.inputTokens, event.outputTokens, priceFor(event.model, overrides));
    add(totals, event, cost);
    for (const name of Object.keys(groups) as Array<keyof typeof groups>) {
      const { key, label } = groupers[name](event);
      let row = groups[name].get(key);
      if (!row) {
        row = emptyRow(key, label);
        groups[name].set(key, row);
      }
      add(row, event, cost);
    }
  }

  const rank = (a: UsageRow, b: UsageRow) =>
    (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
  return {
    ...range,
    totals,
    byDay: [...groups.day.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byAgent: [...groups.agent.values()].sort(rank),
    byModel: [...groups.model.values()].sort(rank),
    bySource: [...groups.source.values()].sort(rank),
    byUser: [...groups.user.values()].sort(rank),
  };
}

const SOURCE_LABELS: Record<UsageEvent["source"], string> = {
  chat: "Chat",
  routine: "Routine",
  listener: "Listener",
  agent_mail: "Agent mail",
};
