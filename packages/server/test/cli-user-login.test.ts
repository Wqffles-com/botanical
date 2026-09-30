import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runAsUser } from "@botanical/db";
import { clearCliAvailabilityCache } from "@botanical/providers";

import { cliUserHome, userCliAvailability } from "../src/cli-install/service.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import { seedInstance } from "../src/db/store.ts";
import type { ModelProfile } from "../src/types.ts";
import { ECHO_PROFILE } from "./helpers.ts";

const fixture = fileURLToPath(new URL("../../providers/test/fixtures/fake-cli.ts", import.meta.url));
chmodSync(fixture, 0o755);

function grokLogin(home: string): void {
  mkdirSync(join(home, ".grok"), { recursive: true });
  writeFileSync(join(home, ".grok", "auth.json"), '{"test":true}\n');
}

describe("CLI availability for the acting user", () => {
  let home: string;
  const env = (): Record<string, string | undefined> => ({ BOTANICAL_CLI_HOME: home, XAI_API_KEY: "" });

  beforeEach(() => {
    clearCliAvailabilityCache();
    home = mkdtempSync(join(tmpdir(), "botanical-cli-user-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("a settings-panel login in the user's CLI home counts", async () => {
    grokLogin(cliUserHome(home, "user-1"));
    const result = await runAsUser("user-1", () => userCliAvailability({ cli: "grok", bin: fixture }, env()));
    expect(result.status.available).toBe(true);
    expect(result.env.HOME).toBe(cliUserHome(home, "user-1"));
  });

  test("a login in the shared server home still counts and the turn runs there", async () => {
    grokLogin(home);
    const result = await runAsUser("user-1", () => userCliAvailability({ cli: "grok", bin: fixture }, env()));
    expect(result.status.available).toBe(true);
    expect(result.env.BOTANICAL_CLI_HOME).toBe(home);
  });

  test("another user's login does not count", async () => {
    grokLogin(cliUserHome(home, "user-2"));
    const result = await runAsUser("user-1", () => userCliAvailability({ cli: "grok", bin: fixture }, env()));
    expect(result.status.available).toBe(false);
    expect(result.status.unavailableReason).toContain("not logged in");
  });
});

describe("seedInstance", () => {
  const config = (profiles: ModelProfile[]) => ({
    profiles,
    encryptionKey: null,
    dictation: { mode: "browser" as const },
  });

  test("adds CLI profiles enabled after first boot", async () => {
    const store = createMemoryStore();
    const api: ModelProfile = { ...ECHO_PROFILE };
    const grok: ModelProfile = { id: "grok-build", name: "Grok Build", provider: "cli", kind: "cli", cli: "grok", model: "grok" };
    const claude: ModelProfile = { id: "claude-code", name: "Claude Code", provider: "cli", kind: "cli", cli: "claude", model: "claude" };
    await seedInstance(store, config([api, grok]) as never, {});
    await store.globalProfiles.upsert({ ...grok, name: "Renamed" });
    await seedInstance(store, config([api, grok, claude]) as never, {});
    const ids = (await store.globalProfiles.list()).map((profile) => profile.id);
    expect(ids).toEqual(["claude-code", "echo", "grok-build"]);
    const kept = (await store.globalProfiles.list()).find((profile) => profile.id === "grok-build");
    expect(kept?.name).toBe("Renamed");
  });

  test("adds API models listed after first boot once, and not again after an admin removes one", async () => {
    const store = createMemoryStore();
    const base: ModelProfile = { id: "deepseek", name: "DeepSeek", provider: "deepseek", model: "deepseek-flash" };
    const pro: ModelProfile = { id: "deepseek--deepseek-v4-pro", name: "DeepSeek (deepseek-v4-pro)", provider: "deepseek", model: "deepseek-v4-pro" };
    await seedInstance(store, config([base]) as never, {});
    await seedInstance(store, config([base, pro]) as never, {});
    expect((await store.globalProfiles.list()).map((profile) => profile.id)).toEqual(["deepseek", "deepseek--deepseek-v4-pro"]);
    await store.globalProfiles.delete(pro.id);
    await seedInstance(store, config([base, pro]) as never, {});
    expect((await store.globalProfiles.list()).map((profile) => profile.id)).toEqual(["deepseek"]);
  });

  test("moves profiles off retired models and gives Anthropic profiles maxTokens", async () => {
    const store = createMemoryStore();
    await seedInstance(store, config([]) as never, {});
    await store.globalProfiles.upsert({ id: "deepseek", name: "DeepSeek", provider: "deepseek", model: "deepseek-chat" });
    await store.globalProfiles.upsert({ id: "anthropic", name: "Anthropic", provider: "anthropic", model: "claude-sonnet-5-5" });
    await seedInstance(store, config([]) as never, {});
    const rows = await store.globalProfiles.list();
    expect(rows.find((profile) => profile.id === "deepseek")?.model).toBe("deepseek-flash");
    expect(rows.find((profile) => profile.id === "anthropic")?.maxTokens).toBe(4096);
  });
});
