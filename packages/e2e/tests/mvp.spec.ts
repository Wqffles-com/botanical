import { test } from "@playwright/test";
import type { AgentDraft } from "../src/ui";
import {
  createAgent,
  expectAgentIdentity,
  expectChatPersisted,
  expectProfileRequired,
  expectSettingsTabs,
  expectStreamedReply,
  login,
  openAgent,
  selectMockProfile,
  sendInboxMessage,
  sendMessage,
  sidebar,
  startChat,
} from "../src/ui";

function stamp(): string {
  return Math.random().toString(36).slice(2, 8);
}

test("MVP golden path", async ({ page }) => {
  test.setTimeout(180_000);
  const id = stamp();
  const fern: AgentDraft = {
    name: `Fern ${id}`,
    icon: "Sprout",
    color: "violet",
    description: "E2E gardener",
    prompt: "You tend the garden and may list files.",
  };
  const scout: AgentDraft = {
    name: `Scout ${id}`,
    icon: "Search",
    color: "amber",
    description: "E2E scout",
    prompt: "You look things up.",
  };
  const message = `ping ${id} list the workspace`;
  const note = `note ${id} beds are watered`;

  await test.step("login with the passcode", async () => {
    await login(page);
  });

  await test.step("create an agent with a name, icon, and color", async () => {
    await createAgent(page, fern);
    await expectAgentIdentity(sidebar(page), fern.name, fern.icon, fern.color);
  });

  await test.step("create a second agent to receive an inbox message", async () => {
    await createAgent(page, scout);
    await expectAgentIdentity(sidebar(page), scout.name, scout.icon, scout.color);
  });

  await test.step("sidebar and picker show each icon and color", async () => {
    await page.goto("/agents");
    const picker = page.getByRole("main");
    await expectAgentIdentity(picker, fern.name, fern.icon, fern.color);
    await expectAgentIdentity(picker, scout.name, scout.icon, scout.color);
    await expectAgentIdentity(sidebar(page), fern.name, fern.icon, fern.color);
    await expectAgentIdentity(sidebar(page), scout.name, scout.icon, scout.color);
  });

  await test.step("start a chat as Fern", async () => {
    await openAgent(page, fern.name);
    await startChat(page, fern.name);
    await expectAgentIdentity(page.getByRole("main"), fern.name, fern.icon, fern.color);
  });

  await test.step("a model profile is required", async () => {
    await expectProfileRequired(page);
  });

  await test.step("pick the Mock profile and send a message", async () => {
    await selectMockProfile(page);
    await sendMessage(page, message);
  });

  await test.step("the streamed reply includes a tool call card", async () => {
    await expectStreamedReply(page);
  });

  await test.step("reload keeps the thread and the agent", async () => {
    await expectChatPersisted(page, message, fern);
  });

  await test.step("an agent-to-agent note shows up in /inbox", async () => {
    await sendInboxMessage(page, fern.name, scout.name, note);
  });

  await test.step("settings tabs open", async () => {
    await expectSettingsTabs(page);
  });
});
