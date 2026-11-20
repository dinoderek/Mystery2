import { test, expect } from "@playwright/test";
import { signInAsTestProfile } from "./test-profile";

test("keeps the V2 lighthouse first and selects its native MSF alternative by number", async ({
  page,
}) => {
  await signInAsTestProfile(page, "msf-pair");
  const catalog = await (await page.request.get("/api/blueprints-list")).json();
  const index = catalog.blueprints.findIndex(
    (entry: { id: string }) =>
      entry.id === "46e4e135-82fe-4389-af0b-80aa749867a1",
  );
  const original = catalog.blueprints.findIndex(
    (entry: { id: string }) =>
      entry.id === "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47",
  );
  expect(index).toBeGreaterThan(original);
  expect(index).toBeLessThan(9);
  await page.goto("/");
  await expect(page.getByText("1. Start a new game", { exact: true })).toBeVisible();
  await page.keyboard.press("1");
  await expect(
    page.getByRole("heading", {
      name: "The Missing Lighthouse Lens",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "The Missing Lighthouse Lens — MSF experiment",
      exact: true,
    }),
  ).toBeVisible();
  const starting = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/game-start") &&
      response.request().method() === "POST",
  );
  await page.keyboard.press(String(index + 1));
  const response = await starting;
  expect(response.status()).toBe(200);
  expect((await response.json()).narration_events[0].payload).toMatchObject({
    case_format: "msf/0.1.0",
    case_revision: 1,
  });
  await expect(page).toHaveURL(/\/session/);
});
