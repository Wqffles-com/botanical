import { createToolContributor as createFileToolsContributor, type FileContributorOptions } from "@botanical/tools";
import { createToolContributor as createShellToolsContributor, type ShellContributorOptions } from "@botanical/tools-shell";
import {
  createToolContributor as createWebToolsContributor,
  type DnsLookup,
  type FetchLike,
  type WebContributorOptions,
} from "@botanical/tools-web";

import { createSendAgentMessageContributor, unavailableAgentService, type AgentToAgentService } from "./a2a.ts";
import type { ToolRegistry } from "./types.ts";

export interface BuiltinToolsOptions {
  workspaceRoot?: string;
  env?: Record<string, string | undefined>;
  /** m10 A2A service. When omitted, send_agent_message reports that messaging is not configured. */
  agentMessages?: AgentToAgentService;
  fileTimeoutMs?: number;
  shellTimeoutMs?: number;
  webTimeoutMs?: number;
  a2aTimeoutMs?: number;
  maxOutputChars?: number;
  fetch?: FetchLike;
  dnsLookup?: DnsLookup;
}

/**
 * Register file, shell, web, and send_agent_message contributors.
 * Contributor ids match what m06's catalog loads: `builtin.files`,
 * `builtin.shell`, `builtin.web`, plus `builtin.a2a` for the send stub.
 * Registering again replaces the same id.
 */
export function registerBuiltinTools(registry: ToolRegistry, options: BuiltinToolsOptions = {}): string[] {
  const shared = {
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.maxOutputChars ? { maxOutputChars: options.maxOutputChars } : {}),
  };
  const fileOptions: FileContributorOptions = {
    ...shared,
    ...(options.fileTimeoutMs ? { timeoutMs: options.fileTimeoutMs } : {}),
  };
  const shellOptions: ShellContributorOptions = {
    ...shared,
    ...(options.shellTimeoutMs ? { timeoutMs: options.shellTimeoutMs } : {}),
  };
  const webOptions: WebContributorOptions = {
    ...(options.env ? { env: options.env } : {}),
    ...(options.maxOutputChars ? { maxOutputChars: options.maxOutputChars } : {}),
    ...(options.webTimeoutMs ? { timeoutMs: options.webTimeoutMs } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
  };
  const contributors = [
    createFileToolsContributor(fileOptions),
    createShellToolsContributor(shellOptions),
    createWebToolsContributor(webOptions),
    createSendAgentMessageContributor(options.agentMessages ?? unavailableAgentService(), {
      ...(options.a2aTimeoutMs ? { timeoutMs: options.a2aTimeoutMs } : {}),
      ...(options.maxOutputChars ? { maxOutputChars: options.maxOutputChars } : {}),
    }),
  ];
  for (const contributor of contributors) registry.register(contributor);
  return contributors.map((contributor) => contributor.id);
}
