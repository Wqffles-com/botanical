import { expect, test } from "@playwright/test";
import { passcodeInput, submitLogin } from "../src/ui";

test("a wrong passcode stays on /login", async ({ page }) => {
  await page.goto("/login");
  await passcodeInput(page).fill("not-the-passcode");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/login\/?$/);
  await expect(
    page.getByRole("alert").or(page.getByText(/invalid|incorrect|wrong passcode|could not sign in/i)).first(),
  ).toBeVisible();
});

test("anonymous visits to app routes land on /login", async ({ page }) => {
  for (const path of ["/agents", "/inbox", "/settings"]) {
    await page.goto(path);
    // ?next= sends the operator back after login. The fixture uses a bare /login.
    await expect(page).toHaveURL(/\/login\/?(?:\?.*)?$/);
    const url = new URL(page.url());
    expect(url.pathname.replace(/\/$/, "") || "/").toBe("/login");
    const next = url.searchParams.get("next");
    expect(next === null || next === path).toBe(true);
    await expect(passcodeInput(page)).toBeVisible();
  }
});
