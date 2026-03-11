import { expect, test } from "@playwright/test";
import { loginWithSeedUser } from "./test-auth";

test.skip(
  process.env.AI_LIVE !== "1",
  "Live browser smoke is opt-in (set AI_LIVE=1).",
);

test.describe("Live AI smoke", () => {
  test("loads a real session and executes one live command", async ({ page }) => {
    await loginWithSeedUser(page);

    await expect(page.getByText("1. Start a new game")).toBeVisible();
    await page.keyboard.press("1");
    await expect(page.getByText("Mock Blueprint")).toBeVisible();
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/.*\/session/);

    const input = page.locator("input[type='text']");
    await input.fill("search");
    await input.press("Enter");

    await expect(page.locator(".overflow-y-auto")).toBeVisible();
    await expect(page.getByText(/TIME:/)).toBeVisible();
  });
});
