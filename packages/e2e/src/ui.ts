import { expect, type Locator, type Page } from "@playwright/test";
import { MOCK_TOOL_NAME } from "./contract";
import { passcode } from "./env";

export interface AgentDraft {
  name: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sidebar(page: Page): Locator {
  return page.locator('[data-sidebar="sidebar"]').or(page.locator("aside")).first();
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

export function passcodeInput(page: Page): Locator {
  return page.getByLabel(/passcode/i).or(page.getByTestId("passcode")).or(page.locator('input[type="password"]')).first();
}

export async function submitLogin(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(continue|unlock|sign in|log in)$/i }).click();
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(passcodeInput(page)).toBeVisible();
  await passcodeInput(page).fill(passcode());
  await submitLogin(page);
  await expect(page).not.toHaveURL(/\/login\/?$/, { timeout: 20_000 });
  await expect(sidebar(page)).toBeVisible();
}

async function clickFirstVisible(locator: Locator): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) {
      await item.click();
      return;
    }
  }
  await locator.first().click();
}

async function fillTextbox(root: Locator, name: RegExp, value: string): Promise<void> {
  const field = root.getByRole("textbox", { name }).or(root.getByLabel(name)).first();
  await field.fill(value);
}

async function pickIcon(page: Page, icon: string): Promise<void> {
  const exact = new RegExp(`^${escapeRegExp(icon)}$`, "i");
  const trigger = main(page)
    .getByRole("button", { name: /choose icon|select icon|^icon$|^icon:/i })
    .or(page.getByTestId("icon-picker"))
    .first();
  await trigger.click();

  const popup = page
    .locator(
      "[role='dialog'], [role='listbox'], [data-radix-popper-content-wrapper], [data-testid='icon-picker-popover']",
    )
    .last();
  await expect(popup).toBeVisible();

  const search = popup.getByRole("textbox").or(popup.getByPlaceholder(/search/i)).first();
  if (await search.isVisible().catch(() => false)) await search.fill(icon);

  const choice = popup
    .getByRole("option", { name: exact })
    .or(popup.getByRole("button", { name: exact }))
    .or(popup.getByRole("menuitem", { name: exact }));
  await choice.first().click();

  if (await popup.isVisible().catch(() => false)) await page.keyboard.press("Escape");
}

async function pickColor(page: Page, color: string): Promise<void> {
  const name = new RegExp(`^${escapeRegExp(color)}$`, "i");
  const swatch = main(page).getByRole("radio", { name }).or(main(page).getByRole("button", { name })).first();
  await swatch.click();
}

async function allowTool(page: Page, toolId: string): Promise<void> {
  const box = main(page).getByRole("checkbox", { name: new RegExp(toolId.replace("_", "[_ ]?"), "i") });
  try {
    await box.first().waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }
  await box.first().setChecked(true);
}

export async function createAgent(page: Page, draft: AgentDraft): Promise<void> {
  await page.goto("/agents/new");
  await expect(page).toHaveURL(/\/agents\/new\/?$/);
  const root = main(page);
  await fillTextbox(root, /^(name|display name)$/i, draft.name);
  await fillTextbox(root, /^description$/i, draft.description);
  await fillTextbox(root, /^(prompt|system prompt)$/i, draft.prompt);
  await pickIcon(page, draft.icon);
  await pickColor(page, draft.color);
  await allowTool(page, MOCK_TOOL_NAME);
  await root.getByRole("button", { name: /^(save|create|save agent|create agent|save changes)$/i }).click();
  await expect(page).not.toHaveURL(/\/agents\/new\/?$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: draft.name })).toBeVisible();
}

/**
 * The avatar next to `name` exposes the lucide icon and AgentColor.
 * Preferred hook: `data-icon` and `data-color` on the avatar (or its row).
 * Also accepts an `svg.lucide-*` plus a color token in class, aria-label, or data-color.
 */
export async function expectAgentIdentity(scope: Locator, name: string, icon: string, color: string): Promise<void> {
  await expect(scope.getByText(name, { exact: true }).first(), `expected to see ${name}`).toBeVisible();
  const iconName = icon.toLowerCase();
  const colorName = color.toLowerCase();
  await expect
    .poll(
      async () => rowHasIdentity(scope, name, iconName, colorName),
      {
        timeout: 8_000,
        message: `Expected ${name} to show icon ${icon} and color ${color}. Put data-icon="${icon}" and data-color="${color}" on the avatar beside the name.`,
      },
    )
    .toBe(true);
}

async function rowHasIdentity(scope: Locator, name: string, icon: string, color: string): Promise<boolean> {
  const avatars = scope.locator(`[data-icon="${icon}" i][data-color="${color}" i]`);
  const avatarCount = await avatars.count();
  for (let index = 0; index < avatarCount; index += 1) {
    if (await avatarBelongsTo(avatars.nth(index), name, color)) return true;
  }

  const icons = scope.locator(`svg.lucide-${icon}`);
  const iconCount = await icons.count();
  for (let index = 0; index < iconCount; index += 1) {
    const iconNode = icons.nth(index);
    if (!(await iconNode.isVisible())) continue;
    if (await coloredRowAround(iconNode, name, color)) return true;
  }
  return false;
}

async function coloredRowAround(node: Locator, name: string, color: string): Promise<boolean> {
  const ancestors = node.locator("xpath=ancestor::*[position()<=6]");
  const count = await ancestors.count();
  for (let index = 0; index < count; index += 1) {
    const row = ancestors.nth(index);
    const text = ((await row.innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length > 240) continue;
    if (!text.toLowerCase().includes(name.toLowerCase())) continue;
    if (await colorToken(row, color)) return true;
    const nested = row.locator(
      `[data-color="${color}" i], [data-agent-color="${color}" i], [class*="${color}" i], [aria-label*="${color}" i]`,
    );
    if ((await nested.count()) > 0) return true;
  }
  return false;
}

async function avatarBelongsTo(avatar: Locator, name: string, color: string): Promise<boolean> {
  if (!(await avatar.isVisible())) return false;
  const agentName = ((await avatar.getAttribute("data-agent-name")) ?? "").toLowerCase();
  if (agentName === name.toLowerCase()) return true;
  const aria = ((await avatar.getAttribute("aria-label")) ?? "").toLowerCase();
  if (aria.includes(name.toLowerCase()) && (await colorToken(avatar, color))) return true;

  const ancestors = avatar.locator("xpath=ancestor::*[self::a or self::li or self::header or self::article or self::div][position()<=4]");
  const count = await ancestors.count();
  for (let index = 0; index < count; index += 1) {
    const row = ancestors.nth(index);
    if (!(await row.isVisible())) continue;
    const text = ((await row.innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 240) continue;
    if (text.toLowerCase().includes(name.toLowerCase())) return true;
  }
  return false;
}

async function colorToken(node: Locator, color: string): Promise<boolean> {
  const data = ((await node.getAttribute("data-color")) ?? (await node.getAttribute("data-agent-color")) ?? "").toLowerCase();
  if (data === color) return true;
  const className = ((await node.getAttribute("class")) ?? "").toLowerCase();
  const label = ((await node.getAttribute("aria-label")) ?? "").toLowerCase();
  return className.includes(color) || label.includes(color);
}

export async function openAgent(page: Page, name: string): Promise<void> {
  const item = sidebar(page).getByRole("link", { name }).or(sidebar(page).getByRole("button", { name }));
  await clickFirstVisible(item);
  await expect(page).toHaveURL(/\/agents\/[^/]+$/);
}

export async function startChat(page: Page, agentName: string): Promise<void> {
  await clickFirstVisible(
    page.getByRole("button", { name: /^(new chat|start chat)$/i }).or(
      page.getByRole("link", { name: /^(new chat|start chat)$/i }),
    ),
  );

  const landed = await page
    .waitForURL(/\/chats\/[^/?#]+/, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (landed) return;

  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    const choice = dialog.getByText(agentName, { exact: true });
    if ((await choice.count()) > 0) await choice.first().click();
    const confirm = dialog.getByRole("button", { name: /^(new chat|start chat|create|continue)$/i });
    if ((await confirm.count()) > 0 && (await confirm.first().isEnabled())) await confirm.first().click();
  }

  await expect(page).toHaveURL(/\/chats\/[^/?#]+/, { timeout: 20_000 });
}

function profileField(page: Page): Locator {
  const root = main(page);
  return root
    .getByTestId("profile-select")
    .or(root.getByRole("combobox", { name: /model profile|^profile$|^model$/i }))
    .or(root.getByLabel(/model profile|^profile$|^model$/i))
    .first();
}

function composerField(page: Page): Locator {
  const root = main(page);
  return root.getByTestId("composer").or(root.getByRole("textbox", { name: /message/i })).first();
}

function sendButton(page: Page): Locator {
  const root = main(page);
  return root.getByTestId("send").or(root.getByRole("button", { name: /^send$/i })).first();
}

export async function expectProfileRequired(page: Page): Promise<void> {
  const composer = composerField(page);
  const send = sendButton(page);
  await expect(composer).toBeVisible();
  await expect(send).toBeVisible();
  await expect
    .poll(async () => (await composer.isDisabled()) || (await send.isDisabled()))
    .toBe(true);

  const field = profileField(page);
  await expect(field).toBeVisible();
  const tag = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") {
    await expect
      .poll(async () => {
        const labels = await field.locator("option").allTextContents();
        return labels.some((label) => /\bmock\b/i.test(label));
      })
      .toBe(true);
    expect(await field.inputValue(), "Model profile starts empty. Botanical has no default model.").toBe("");
  } else {
    await expect(field).not.toHaveText(/^\s*mock\b/i);
  }

  await expect
    .poll(async () => {
      const placeholder = (await composer.getAttribute("placeholder")) ?? "";
      if (/profile|model/i.test(placeholder)) return true;
      const hint = main(page).getByText(/profile_required|choose a model profile|select a model profile|no default model/i);
      return hint
        .first()
        .isVisible()
        .catch(() => false);
    })
    .toBe(true);
}

async function chooseOption(page: Page, field: Locator, option: RegExp): Promise<void> {
  await expect(field).toBeVisible();
  const tag = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") {
    const labels = (await field.locator("option").allTextContents()).map((label) => label.trim());
    const hit = labels.find((label) => option.test(label));
    if (!hit) throw new Error(`No option matching ${option} among: ${labels.join(" | ")}`);
    await field.selectOption({ label: hit });
    return;
  }
  await field.click();
  await page.getByRole("option", { name: option }).first().click();
}

export async function selectMockProfile(page: Page): Promise<void> {
  await chooseOption(page, profileField(page), /\bmock\b/i);
  await expect(composerField(page)).toBeEnabled();
}

export async function sendMessage(page: Page, content: string): Promise<void> {
  const composer = composerField(page);
  const send = sendButton(page);
  await composer.fill(content);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(main(page).getByText(content).first()).toBeVisible();
}

export async function expectStreamedReply(page: Page): Promise<void> {
  await expect(main(page).getByText(/mock:/i).first()).toBeVisible({ timeout: 30_000 });
  await expectToolCard(page, MOCK_TOOL_NAME);
}

async function expectToolCard(page: Page, toolName: string): Promise<void> {
  const root = main(page);
  const named = new RegExp(`\\b${escapeRegExp(toolName)}\\b`, "i");
  const card = root
    .locator('[data-testid="tool-call"], [data-testid="tool-call-card"], [data-tool-name]')
    .or(root.getByRole("button", { name: named }))
    .or(root.locator("summary").filter({ hasText: named }))
    .or(root.getByRole("group", { name: named }));
  await expect(card.first(), `expected a ${toolName} tool call card`).toBeVisible({ timeout: 30_000 });
  await expect(card.first()).toContainText(named);
}

export async function expectChatPersisted(page: Page, content: string, agent: AgentDraft): Promise<void> {
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  const root = main(page);
  await expect(root.getByText(content).first()).toBeVisible();
  await expect(root.getByText(/mock:/i).first()).toBeVisible();
  await expectToolCard(page, MOCK_TOOL_NAME);
  await expectAgentIdentity(sidebar(page), agent.name, agent.icon, agent.color);
}

export async function sendInboxMessage(page: Page, fromName: string, toName: string, body: string): Promise<void> {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/inbox\/?$/);
  const root = main(page);
  const message = root
    .getByLabel(/^(message|body|note)$/i)
    .or(root.getByRole("textbox", { name: /^(message|body|note)$/i }))
    .first();
  if (!(await message.isVisible().catch(() => false))) {
    await clickFirstVisible(root.getByRole("button", { name: /compose|new message|write/i }));
  }
  const from = root
    .getByTestId("inbox-from")
    .or(root.getByLabel(/^from$/i))
    .or(root.getByRole("combobox", { name: /^from$/i }))
    .first();
  const to = root
    .getByTestId("inbox-to")
    .or(root.getByLabel(/^to$/i))
    .or(root.getByRole("combobox", { name: /^(to|recipient)$/i }))
    .first();
  await chooseOption(page, from, new RegExp(escapeRegExp(fromName), "i"));
  await chooseOption(page, to, new RegExp(escapeRegExp(toName), "i"));
  const bodyField = root
    .getByLabel(/^(message|body|note)$/i)
    .or(root.getByRole("textbox", { name: /^(message|body|note)$/i }))
    .first();
  await bodyField.fill(body);
  await root.getByRole("button", { name: /^(send|deliver|post)$/i }).click();
  const note = root.getByText(body).locator("visible=true").first();
  await expect(note).toBeVisible();
  await expect
    .poll(async () => inboxRowShows(note, fromName, toName), {
      message: `Inbox entry “${body}” should show ${fromName} and ${toName}.`,
    })
    .toBe(true);
}

async function inboxRowShows(note: Locator, fromName: string, toName: string): Promise<boolean> {
  const ancestors = note.locator("xpath=ancestor::*[position()<=6]");
  const count = await ancestors.count();
  for (let index = 0; index < count; index += 1) {
    const row = ancestors.nth(index);
    const text = ((await row.innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 800) continue;
    if (text.includes(fromName) && text.includes(toName)) return true;
  }
  return false;
}

export async function expectSettingsTabs(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/?$/);
  const tabs: { name: RegExp; text: RegExp }[] = [
    { name: /^profiles$/i, text: /\bmock\b/i },
    { name: /^tools$/i, text: /tool|file_list|web_search|shell/i },
    { name: /^mcp$/i, text: /mcp|server/i },
    { name: /^deployment$/i, text: /self[-\s]?host|saas/i },
  ];
  for (const tab of tabs) {
    const trigger = page.getByRole("tab", { name: tab.name });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: tab.name });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(tab.text);
  }
}
