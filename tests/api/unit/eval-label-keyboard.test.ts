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

/** Each fault row on the page, as its kind, severity and note. */
const rowsOf = (target: Page) =>
  target.$$eval("#faults .fault", (rows) =>
    rows.map((row) => {
      const fields = (row as HTMLFieldSetElement).elements as unknown as Record<string, HTMLInputElement>;
      return [fields.kind.value, fields.severity.value, fields.note.value];
    }),
  );

describe("the labelling page, by keyboard in a browser", () => {
  it("saves each turn's faults as the keys build them, one row at a time, and the file loads through the truth schema", async () => {
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

    // Clean empties every row, note and all.
    await save({ note: "A second thought." }, "c");
    expect((await labels()).at(-1)).toMatchObject({ sequence: second, faults: [] });

    // `a` starts a second row, which takes its own kind, severity and note; a key after Escape reaches the page again.
    const third = turnOf(page);
    await save("2", "n", { note: "Invents a gate." }, "a", "3", "m", { note: "Hands over a clue unearned." }, "Enter");
    expect((await labels()).at(-1)?.faults).toEqual([
      { kind: "fabrication", severity: "minor", note: "Invents a gate." },
      { kind: "clue_handling", severity: "major", note: "Hands over a clue unearned." },
    ]);

    await save("p");
    expect(turnOf(page)).toBe(third);
    expect(await rowsOf(page)).toEqual([
      ["fabrication", "minor", "Invents a gate."],
      ["clue_handling", "major", "Hands over a clue unearned."],
    ]);

    // Two rows of one kind are refused; `x` takes the current row away again.
    await save("a", "2", { note: "Said twice." }, "Enter");
    expect(await page.getByRole("alert").textContent()).toContain("two faults are fabrication");
    expect(await rowsOf(page)).toHaveLength(3);
    await page.keyboard.press("x");
    expect(await rowsOf(page)).toHaveLength(2);

    // `g` opens the ground truth over the page and Escape closes it.
    const truth = page.locator("#truth .panel");
    expect(await truth.isVisible()).toBe(false);
    await page.keyboard.press("g");
    expect(await truth.isVisible()).toBe(true);
    expect(await truth.textContent()).toContain("Target age: 9");
    await page.keyboard.press("Escape");
    expect(await truth.isVisible()).toBe(false);
    await save("Enter");
    expect((await labels()).at(-1)).toMatchObject({ sequence: third, faults: [{ kind: "fabrication" }, { kind: "clue_handling" }] });

    const set = await loadTruthSet(dir);
    expect(set.games[0].labels).toHaveLength(before + 4);
  });
});

describe("the Clues panel in a browser", () => {
  it("sits beside the narration on a wide screen, under the ground truth's menu, its folds left alone by the keys", async () => {
    const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await wide.goto(new URL("/g/medal/pass-1/turn/7", server.url).href);
      const narration = await wide.locator("section", { hasText: "Narration" }).boundingBox();
      const clues = await wide.locator("#clues").boundingBox();
      expect(clues && narration && clues.x).toBeGreaterThan((narration?.x ?? 0) + (narration?.width ?? 0) - 1);
      expect(clues?.y).toBe(narration?.y);

      const held = wide.locator("#clues-held");
      expect(await held.getByText("Mara saw a shadow").isVisible()).toBe(false);
      await held.locator("summary").click();
      expect(await held.getByText("Mara saw a shadow").isVisible()).toBe(true);
      expect(await wide.locator("#clues-here").getByText("a targeted search (\"look by the wall\") has no next clue").isVisible()).toBe(true);

      // The ground truth opens over the panel, and Escape closes it without folding the panel.
      await wide.keyboard.press("g");
      const truth = wide.locator("#truth .panel");
      const box = await truth.boundingBox();
      const on = clues && box ? { x: clues.x + clues.width / 2, y: Math.max(clues.y, box.y) + 20 } : { x: 0, y: 0 };
      expect(await wide.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("#truth") !== null, on)).toBe(true);
      await wide.keyboard.press("Escape");
      expect(await truth.isVisible()).toBe(false);
      expect(await held.getByText("Mara saw a shadow").isVisible()).toBe(true);
    } finally {
      await wide.close();
    }
  });
});

describe("the labelling page, by touch on a phone", () => {
  it("asks the name, then saves two faults of different severities tapped out from the list of games, the save always in reach", async () => {
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

      const fill = async (index: number, kind: string, severity: string, note: string) => {
        await phone.getByRole("button", { name: "Add a fault" }).tap();
        const row = phone.locator("#faults .fault").nth(index);
        await row.locator("select[name=kind]").selectOption(kind);
        await row.locator("select[name=severity]").selectOption(severity);
        await row.locator("input[name=note]").fill(note);
      };
      await fill(0, "out_of_character", "major", "Talks like a narrator.");
      await fill(1, "spoiler", "minor", "Hints at the garden.");
      await fill(2, "not_age_fit", "minor", "A slip, removed.");
      await phone.locator("#faults .fault").nth(2).getByRole("button", { name: "Remove" }).tap();
      await Promise.all([phone.waitForEvent("load"), phone.getByRole("button", { name: /Save and go on/ }).tap()]);
      expect((await labels()).at(-1)).toMatchObject({
        sequence: turn,
        by: "phone_labeller",
        faults: [
          { kind: "out_of_character", severity: "major", note: "Talks like a narrator." },
          { kind: "spoiler", severity: "minor", note: "Hints at the garden." },
        ],
      });
    } finally {
      await context.close();
    }
  });

  it("opens the ground truth and a speaker's profile over the page in one tap, pushing nothing down, and closes them", async () => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    try {
      await phone.goto(new URL("/g/medal/pass-1/turn/4", server.url).href);
      const form = phone.locator("#label");
      const at = async () => (await form.boundingBox())?.y;
      const resting = await at();

      await phone.getByText("Ground truth").tap();
      const truth = phone.locator("#truth .panel");
      expect(await truth.isVisible()).toBe(true);
      expect(await truth.textContent()).toContain("Dorn slipped into the hall");
      expect(await at()).toBe(resting);
      // The cast is there, each character folded.
      expect(await truth.getByText("He owed money").isVisible()).toBe(false);
      const dorn = truth.locator("details.fold", { hasText: "Dorn Pike" });
      await dorn.locator("summary", { hasText: "Dorn Pike" }).tap();
      await dorn.locator("summary", { hasText: "Alibi, motive" }).tap();
      expect(await truth.getByText("He owed money").isVisible()).toBe(true);

      await truth.getByRole("button", { name: "Close" }).tap();
      expect(await truth.isVisible()).toBe(false);

      await phone.getByText("Mara Vale: profile").tap();
      const profile = phone.locator("#profile .panel");
      expect(await profile.isVisible()).toBe(true);
      // Opening the ground truth again closes the profile, so only one panel is ever open.
      await phone.getByText("Ground truth").tap();
      await profile.waitFor({ state: "hidden", timeout: 2000 });
      await truth.getByRole("button", { name: "Close" }).tap();
      await phone.getByText("Mara Vale: profile").tap();
      expect(await profile.getByText("Warm but nervous.").isVisible()).toBe(true);
      expect(await profile.getByText("I was in the kitchen all evening.").isVisible()).toBe(false);
      expect(await at()).toBe(resting);
      await profile.getByRole("button", { name: "Close" }).tap();
      expect(await profile.isVisible()).toBe(false);
    } finally {
      await context.close();
    }
  });

  it("folds the Clues panel's lists under the narration, so the form stays near, and opens them in one tap", async () => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const phone = await context.newPage();
    try {
      await phone.goto(new URL("/g/medal/pass-1/turn/2", server.url).href);
      const narration = await phone.locator("section", { hasText: "Narration" }).boundingBox();
      const clues = phone.locator("#clues");
      const box = await clues.boundingBox();
      expect(box && narration && box.y).toBeGreaterThanOrEqual((narration?.y ?? 0) + (narration?.height ?? 0));
      // The server opens a short list; a narrow screen folds it, leaving the reveal and the headings.
      const here = phone.locator("#clues-here");
      expect(await here.evaluate((fold) => (fold as HTMLDetailsElement).open)).toBe(false);
      expect(await clues.getByText("clue_hall_1: A muddy footprint").first().isVisible()).toBe(true);
      expect(await here.locator("summary").textContent()).toContain("next clue_hall_1");
      expect(box?.height).toBeLessThan((phone.viewportSize()?.height ?? 0) / 3);

      await here.locator("summary").tap();
      expect(await here.getByText("A torn cloakroom ticket.").isVisible()).toBe(true);
      expect(await here.getByText("next a search gives").isVisible()).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe("pass 2's question in a browser", () => {
  it("ticks a judge's fault into the form and unticks the label's out, the ticks following the rows, and saves the choice as pass 2", async () => {
    // Its own copy: turn 2 is labelled clean and a spoiler judge caught it; turn 3 is labelled out of character and nothing caught it.
    const own = await fs.mkdtemp(path.join(os.tmpdir(), "eval-label-pass2-"));
    await fs.cp(FIXTURE, own, { recursive: true });
    const labelsFile = path.join(own, "games/medal/labels.json");
    const held = JSON.parse(await fs.readFile(labelsFile, "utf8"));
    held.labels.push({ sequence: 3, faults: [{ kind: "out_of_character", severity: "major", note: "Mara talks like a narrator." }], by: "fixture", at: "2026-06-03T09:03:00Z", pass: 1 });
    for (const sequence of [1, 5, 6, 8, 9]) held.labels.push({ sequence, faults: [], by: "fixture", at: "2026-06-02T00:00:00Z", pass: 1 });
    await fs.writeFile(labelsFile, JSON.stringify(held, null, 2));
    const game = { side: "game", game: "medal", variant: null, sequence: null };
    const base = { judge_version: 1, subject_hash: "0000000000000000", model: "opus", sample: 0, duration_ms: null, cost_usd: null };
    const why = "Points the player at the culprit.";
    await fs.writeFile(
      path.join(own, "results/extra.json"),
      JSON.stringify({
        schema_version: "mystery-truth-results/1",
        verdicts: [
          { ...base, subject: game, judge: "gm_spoiler", status: "fail", findings: [{ sequence: 2, kinds: ["spoiler"], severity: "major", judge_kind: "culprit", quote: "q", why, refers_to: null }] },
          { ...base, subject: game, judge: "gm_roleplay", status: "pass", findings: [] },
        ],
      }),
    );
    const pass2 = await startLabelServer({ truthRoot: own, by: "tester", now, log: () => {} });
    const tab = await browser.newPage();
    const ticks = () => tab.$$eval("input.keep", (boxes) => boxes.map((box) => [JSON.parse((box as HTMLInputElement).dataset.fault ?? "{}").kind, (box as HTMLInputElement).checked]));
    const ownLabels = async (): Promise<Label[]> => JSON.parse(await fs.readFile(labelsFile, "utf8")).labels;
    try {
      await tab.goto(new URL("/g/medal/pass-2/turn/2", pass2.url).href);
      expect(await ticks()).toEqual([["spoiler", false]]);
      expect(await rowsOf(tab)).toEqual([]);
      await tab.locator("input.keep").check();
      expect(await rowsOf(tab)).toEqual([["spoiler", "major", why]]);
      // A row whose kind changes takes its tick with it.
      await tab.locator("#faults .fault select[name=kind]").selectOption("fabrication");
      expect(await ticks()).toEqual([["spoiler", false]]);
      await tab.locator("#faults .fault select[name=kind]").selectOption("spoiler");
      expect(await ticks()).toEqual([["spoiler", true]]);
      // A refused save comes back with the rows as typed, and the ticks follow them, not the stored label.
      await tab.getByRole("button", { name: /Add a fault/ }).click();
      await Promise.all([tab.waitForEvent("load"), tab.getByRole("button", { name: /Save and go on/ }).click()]);
      expect(await tab.locator(".error").textContent()).toContain("Not saved");
      expect(await ticks()).toEqual([["spoiler", true]]);
      await tab.locator("#faults .fault").nth(1).getByRole("button", { name: "Remove" }).click();
      await Promise.all([tab.waitForURL(/\/turn\/3$/), tab.getByRole("button", { name: /Save and go on/ }).click()]);
      expect((await ownLabels()).at(-1)).toMatchObject({ sequence: 2, pass: 2, faults: [{ kind: "spoiler", severity: "major", note: why }] });

      // Turn 3: the label's own fault, ticked; unticking it leaves the turn clean.
      expect(await ticks()).toEqual([["out_of_character", true]]);
      await tab.locator("input.keep").uncheck();
      expect(await rowsOf(tab)).toEqual([]);
      await Promise.all([tab.waitForEvent("load"), tab.getByRole("button", { name: /Save and go on/ }).click()]);
      expect((await ownLabels()).at(-1)).toMatchObject({ sequence: 3, pass: 2, faults: [] });
    } finally {
      await tab.close();
      await pass2.close();
      await fs.rm(own, { recursive: true, force: true });
    }
  });
});
