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
import { chromium } from "playwright";
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
  server = await startLabelServer({ truthRoot: dir, game: "medal", pass: 1, by: "tester", now, log: () => {} });
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

/** Presses the keys; the last one submits, so it waits for the page that answers (a refused save stays on its turn). */
async function save(keys: string[], note?: string): Promise<void> {
  for (const key of keys.slice(0, -1)) await page.keyboard.press(key);
  if (note !== undefined) {
    await page.keyboard.press("t");
    await page.keyboard.type(note);
    await page.keyboard.press("Escape");
  }
  await Promise.all([page.waitForEvent("load", { timeout: 5000 }), page.keyboard.press(keys.at(-1) as string)]);
}

describe("the labelling page, by keyboard in a browser", () => {
  it("saves each turn's label as the keys make it, and the file loads through the truth schema", async () => {
    await page.goto(new URL("/", server.url).href);
    const before = (await labels()).length;

    const first = turnOf(page);
    await save(["1", "m", "Enter"], "Names the hiding place before it is earned.");
    expect((await labels()).at(-1)).toMatchObject({
      sequence: first,
      faults: [{ kind: "spoiler", severity: "major", note: "Names the hiding place before it is earned." }],
      by: "tester",
      pass: 1,
    });

    const second = turnOf(page);
    await save(["2", "Enter"]);
    expect(await page.getByRole("alert").textContent()).toContain("a fault needs a note");
    expect(await labels()).toHaveLength(before + 1);

    await save(["c"]);
    expect((await labels()).at(-1)).toMatchObject({ sequence: second, faults: [] });

    const third = turnOf(page);
    await save(["2", "3", "n", "Enter"], "Invents a gate and hands over a clue.");
    expect((await labels()).at(-1)?.faults.map((fault) => [fault.kind, fault.severity])).toEqual([
      ["fabrication", "minor"],
      ["clue_handling", "minor"],
    ]);

    await save(["p"]);
    expect(turnOf(page)).toBe(third);
    expect(await page.$$eval("input[name=kind]:checked", (boxes) => boxes.map((box) => (box as HTMLInputElement).value))).toEqual([
      "fabrication",
      "clue_handling",
    ]);

    const set = await loadTruthSet(dir);
    expect(set.games[0].labels).toHaveLength(before + 3);
  });
});
