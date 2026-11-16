/**
 * The labelling page in a real browser: the keyboard glue the page ships, not
 * only `keys.ts`, turns key presses into saved labels. The server runs in
 * process on a copy of the fixture truth set; Chromium is the one the browser
 * suite already installs.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";
import type { Browser, Page } from "playwright";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { startLabelServer } from "../../../evaluation/label/server.ts";
import type { LabelServer } from "../../../evaluation/label/server.ts";
import { loadTruthSet } from "../../../evaluation/lib/truth/loader.ts";
import type { Label } from "../../../evaluation/lib/truth/schemas.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");

let dir: string;
let server: LabelServer;
let browser: Browser;
let page: Page;

let clock = Date.parse("2026-07-01T10:00:00Z");
const now = () => new Date((clock += 1000));

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-label-keyboard-"));
  await fs.cp(FIXTURE, dir, { recursive: true });
  server = await startLabelServer({ truthRoot: dir, by: "tester", now, log: () => {} });
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function labels(): Promise<Label[]> {
  return JSON.parse(await fs.readFile(path.join(dir, "games/medal/labels.json"), "utf8")).labels;
}

const turnOf = (target: Page) => Number(new URL(target.url()).pathname.split("/").pop());

/** A key, or a note typed as the page asks: `t`, the text, then Escape. */
type Step = string | { note: string };

/**
 * Takes the steps in order; the last is a key that submits, so it waits for
 * the page that answers (a refused save stays on its turn).
 */
async function save(...steps: Step[]): Promise<void> {
  for (const step of steps.slice(0, -1)) {
    if (typeof step === "string") {
      await page.keyboard.press(step);
    } else {
      await page.keyboard.press("t");
      await page.keyboard.type(step.note);
      await page.keyboard.press("Escape");
    }
  }
  await Promise.all([page.waitForEvent("load", { timeout: 5000 }), page.keyboard.press(steps.at(-1) as string)]);
}

describe("the labelling page, by keyboard in a browser", () => {
  it("saves each turn's label as the keys make it, and the file loads through the truth schema", async () => {
    await page.goto(new URL("/g/medal/pass-1/", server.url).href);
    const before = (await labels()).length;

    const first = turnOf(page);
    await save("1", "m", { note: "Names the hiding place before it is earned." }, "Enter");
    expect((await labels()).at(-1)).toMatchObject({
      sequence: first,
      faults: [{ kind: "spoiler", severity: "major", note: "Names the hiding place before it is earned." }],
      by: "tester",
      pass: 1,
    });

    const second = turnOf(page);
    await save("2", "Enter");
    expect(await page.getByRole("alert").textContent()).toContain("a fault needs a note");
    expect(await labels()).toHaveLength(before + 1);

    // Clean empties the note as well as the kinds, or the server refuses a note without a fault.
    await save({ note: "A second thought." }, "c");
    expect((await labels()).at(-1)).toMatchObject({ sequence: second, faults: [] });

    // A key after Escape reaches the page again, not the note.
    const third = turnOf(page);
    await save("2", "n", { note: "Invents a gate and hands over a clue." }, "3", "Enter");
    expect((await labels()).at(-1)?.faults.map((fault) => [fault.kind, fault.severity])).toEqual([
      ["fabrication", "minor"],
      ["clue_handling", "minor"],
    ]);

    await save("p");
    expect(turnOf(page)).toBe(third);
    expect(await page.$$eval("input[name=kind]:checked", (boxes) => boxes.map((box) => (box as HTMLInputElement).value))).toEqual([
      "fabrication",
      "clue_handling",
    ]);

    const set = await loadTruthSet(dir);
    expect(set.games[0].labels).toHaveLength(before + 3);
  });
});

describe("the labelling page, by touch on a phone", () => {
  it("asks the name, then saves a turn tapped out from the list of games, the save always in reach", async () => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    try {
      await phone.goto(new URL("/", server.url).href);
      await phone.getByRole("link", { name: "change" }).tap();
      await phone.locator("input[name=name]").fill("phone_labeller");
      await Promise.all([phone.waitForURL(new URL("/", server.url).href), phone.getByRole("button", { name: "Use this name" }).tap()]);
      expect(await phone.locator("header").textContent()).toContain("labelling as phone_labeller");

      await Promise.all([phone.waitForURL(/\/g\/medal\/pass-1\/turn\/\d+$/), phone.getByRole("link", { name: "pass 1", exact: true }).tap()]);
      const turn = turnOf(phone);
      // The keys are not shown on a touch screen, and the save stays on screen while the page scrolls.
      expect(await phone.locator("kbd").first().isVisible()).toBe(false);
      await phone.evaluate(() => window.scrollTo(0, 0));
      const bar = await phone.locator(".actions").boundingBox();
      const height = phone.viewportSize()?.height ?? 0;
      expect(bar && bar.y + bar.height).toBeLessThanOrEqual(height);
      expect(bar && bar.y).toBeGreaterThan(0);

      await phone.locator(".choices label", { hasText: "out of character" }).tap();
      await phone.locator(".choices label", { hasText: "major" }).tap();
      await phone.locator("input[name=note]").fill("Talks like a narrator.");
      await Promise.all([phone.waitForEvent("load"), phone.getByRole("button", { name: /Save and go on/ }).tap()]);
      expect((await labels()).at(-1)).toMatchObject({
        sequence: turn,
        by: "phone_labeller",
        faults: [{ kind: "out_of_character", severity: "major", note: "Talks like a narrator." }],
      });
    } finally {
      await context.close();
    }
  });
});
