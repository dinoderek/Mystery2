// A run folder as one page: every game's transcript, with each judge finding
// pinned beside the turn it cites.
//
//   report.html   written into the run folder by `play`, and by `report` for a
//                 run that is already on disk
//
// The page is a single self-contained file (report-template.html with the
// run's data inlined), so it opens straight from disk or can be shared as is.
//
// The run's games are the subjects in its run.json. Turns come from each game's
// events.json, not transcript.md: each event carries the sequence number the
// judges cite and the clue ids it recorded. The investigator's input and plan
// for each event come from steps.jsonl, matched by the narration the step got
// back. Lines the game never sent (parser hints, failed calls) have no event
// and are shown where they were typed.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { InputError } from "../../core/errors.ts";
import { readRunIndex } from "../../core/run-folder.ts";
import type { RunIndex } from "../../core/run-folder.ts";
import { readResult } from "../../core/result.ts";
import type { Result } from "../../core/result.ts";
import type { PlayedEvent } from "./database.ts";
import type { GameSummary, PlaytestBlueprint } from "./output.ts";
import type { Step } from "./game.ts";

const TEMPLATE = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "report-template.html");

type Json = Record<string, unknown>;

/** A blueprint as far as the report reads it: a title, an age and the clues' words. */
type ReportBlueprint = Partial<PlaytestBlueprint> & {
  world?: {
    locations?: Array<{ clues?: ClueText[]; sub_locations?: Array<{ clues?: ClueText[] }> }>;
    characters?: Array<{ clues?: ClueText[] }>;
  };
};
interface ClueText {
  id: string;
  text: string;
}

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

function readJsonLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The blueprint behind a run: from a game's trace.json when the run was
 * graded, else the repo's blueprints/ by id. Null when neither has it; clues
 * then show the text their event recorded, or only their id.
 */
function findBlueprint(gameDirs: string[], blueprintId: string | undefined, repoRoot: string): ReportBlueprint | null {
  for (const dir of gameDirs) {
    const trace = readJson<{ blueprint?: ReportBlueprint }>(path.join(dir, "trace.json"));
    if (trace?.blueprint) return trace.blueprint;
  }
  const dir = path.join(repoRoot, "blueprints");
  if (!blueprintId || !fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    const blueprint = parseJson<ReportBlueprint | null>(fs.readFileSync(path.join(dir, name), "utf8"), null);
    if (blueprint?.id === blueprintId) return blueprint;
  }
  return null;
}

function clueTexts(blueprint: ReportBlueprint | null): Record<string, string> {
  const texts: Record<string, string> = {};
  const add = (clues: ClueText[] | undefined) => {
    for (const clue of clues ?? []) texts[clue.id] = clue.text;
  };
  for (const location of blueprint?.world?.locations ?? []) {
    add(location.clues);
    for (const sub of location.sub_locations ?? []) add(sub.clues);
  }
  for (const character of blueprint?.world?.characters ?? []) add(character.clues);
  return texts;
}

/** One finding, pinned to the turn it cites. */
export interface ReportFinding {
  check: string;
  sequence: number;
  severity: string;
  kind: string | null;
  quote: string | null;
  why: string;
}

/** Every finding the result holds: each judge's, and each mechanical violation. */
function readFindings(result: Result | null): ReportFinding[] {
  if (!result) return [];
  const judged = result.verdicts
    .filter((verdict) => verdict.tier === "judge")
    .flatMap((verdict) =>
      ((verdict.findings ?? []) as Json[]).map((finding) => ({
        check: verdict.id,
        sequence: finding.sequence as number,
        severity: finding.severity as string,
        kind: (finding.kind as string | undefined) ?? null,
        quote: typeof finding.quote === "string" ? finding.quote : null,
        why: (finding.why as string | undefined) ?? "",
      })),
    );
  const mechanical = result.verdicts
    .filter((verdict) => verdict.tier === "mechanical")
    .flatMap((check) =>
      (((check.details as Json | undefined)?.violations ?? []) as Json[]).map((violation) => ({
        check: check.id,
        sequence: violation.sequence as number,
        severity: "mechanical",
        kind: violation.reason as string,
        quote: null,
        why: Object.entries(violation)
          .filter(([key]) => key !== "sequence" && key !== "reason")
          .map(([key, value]) => `${key}: ${value}`)
          .join(", "),
      })),
    );
  return [...mechanical, ...judged];
}

type Part = PlayedEvent["parts"][number];
const firstText = (parts: Part[] | undefined): string => (parts?.[0]?.text ?? "").trim();

/** One row of the page: a saved event, or a line that never reached the game. */
export interface ReportTurn {
  seq: number | null;
  type: string;
  input: string | null;
  plan: string | null;
  asDialogue: boolean;
  turnsLeft: number | null;
  parts: Array<{ speaker: string; character: boolean; text: string }>;
  clues: Array<{ id: string; text: string | null }>;
  grade: { value: number | null; pass: boolean } | null;
  note?: { kind: string; text: string };
}

function stepRow(step: Step): Pick<ReportTurn, "input" | "plan" | "asDialogue"> {
  const action = step.action as { event_type?: string | null };
  return {
    input: step.input,
    plan: step.plan ?? null,
    // A line the player typed mid-conversation that reads like a command is
    // still a question to the character: talk mode only knows `bye`.
    asDialogue:
      step.mode_before === "talk" &&
      action?.event_type === "ask" &&
      /^(accuse|go to|move to|search|talk to|speak (to|with))\b/i.test(step.input.trim()),
  };
}

interface Reading {
  narrations?: Array<{ sequence: number; grade: number | null; status: string }>;
}

function eventTurn(event: PlayedEvent, step: Step | null, clueText: Record<string, string>, reading: Reading | null): ReportTurn {
  const grade = reading?.narrations?.find((entry) => entry.sequence === event.sequence);
  const payload = event.payload as Json & { diagnostics?: { time_after?: number } };
  const ids = event.type === "search"
    ? (payload.revealed_clue_id ? [payload.revealed_clue_id as string] : [])
    : ((payload.revealed_clue_ids ?? []) as string[]);
  return {
    seq: event.sequence,
    type: event.type,
    ...(step ? stepRow(step) : { input: null, plan: null, asDialogue: false }),
    turnsLeft: payload.diagnostics?.time_after ?? null,
    parts: event.parts.map((part) => ({
      speaker: part.speaker?.label ?? "Narrator",
      character: part.speaker?.kind === "character",
      text: part.text ?? "",
    })),
    clues: ids.map((id) => ({
      id,
      text: (id === payload.revealed_clue_id ? (payload.revealed_clue_text as string | undefined) : null) ?? clueText[id] ?? null,
    })),
    grade: grade ? { value: grade.grade, pass: grade.status === "pass" } : null,
  };
}

/** The row for a line that never reached the game: a parser hint, a view, or a failed call. */
function noteTurn(step: Step): ReportTurn {
  const action = step.action as { kind: string; text?: string };
  const note = action.kind === "refused" || action.kind === "view"
    ? { kind: "feedback", text: action.text ?? "" }
    : action.kind === "quit"
    ? { kind: "feedback", text: "The investigator stopped playing." }
    : { kind: "error", text: `Request failed (${step.response?.status ?? "no response"})` };
  return {
    seq: null,
    type: note.kind,
    ...stepRow(step),
    turnsLeft: step.time_after ?? null,
    parts: [],
    clues: [],
    grade: null,
    note,
  };
}

/** The first narration of the events this step got back, which is how it is matched to its event. */
function stepNarration(step: Step): string {
  const body = step.response?.ok ? (step.response.body as { events?: Array<{ narration_parts?: Part[] }> } | null) : null;
  return firstText(body?.events?.[0]?.narration_parts);
}

/**
 * Lays the game's events out in order, each with the input and plan that led
 * to it. Steps that never reached the game (a parser hint, a failed call) get
 * a row of their own where they were typed.
 */
function buildTurns(events: PlayedEvent[], steps: Step[], clueText: Record<string, string>, reading: Reading | null): ReportTurn[] {
  const turns: ReportTurn[] = [];
  let next = 0;

  for (const step of steps) {
    // The first unclaimed event with the narration this step got back: mock
    // narration repeats, so the search starts after the last match.
    const text = stepNarration(step);
    const found = text ? events.slice(next).findIndex((event) => firstText(event.parts) === text) : -1;
    if (found === -1) {
      turns.push(noteTurn(step));
      continue;
    }
    const at = next + found;
    while (next < at) turns.push(eventTurn(events[next++], null, clueText, reading));
    turns.push(eventTurn(events[next++], step, clueText, reading));
  }
  while (next < events.length) turns.push(eventTurn(events[next++], null, clueText, reading));
  return turns;
}

/** What one game shows on the page. */
export interface ReportGame {
  number: number;
  gameId: string | null;
  outcome: string | null;
  stopReason: string | null;
  error: string | null;
  replayOf: string | null;
  turnsUsed: number | null;
  timeBudget: number | null;
  steps: number;
  cluesFound: number | null;
  cluesTotal: number | null;
  cost: { narrator: number | null; investigator: number | null; judges: number | null };
  wallSeconds: number | null;
  judges: unknown;
  mechanical: unknown;
  readability: unknown;
  findings: ReportFinding[];
  turns: ReportTurn[];
}

export interface ReportData {
  run: string;
  title: string;
  persona: string | null;
  narratorModel: string | null;
  investigatorModel: string | null;
  targetAge: number | null;
  games: ReportGame[];
  failed: Array<{ number: number; error: string }>;
}

type GradesOnSummary = {
  error?: string;
  judges?: unknown;
  mechanical?: unknown;
  readability?: unknown;
  judge_cost_usd?: number | null;
} | null;

function buildGame(number: number, dir: string, summary: GameSummary, clueText: Record<string, string>, result: Result | null): ReportGame {
  const grades = (summary.grades ?? null) as GradesOnSummary;
  const steps = readJsonLines<Step>(path.join(dir, "steps.jsonl"));
  const events = readJson<PlayedEvent[]>(path.join(dir, "events.json")) ?? [];
  return {
    number,
    gameId: summary.game_id ?? null,
    outcome: summary.outcome ?? null,
    stopReason: summary.stop_reason ?? null,
    error: summary.error ?? grades?.error ?? null,
    replayOf: summary.replay_of ?? null,
    turnsUsed: summary.turns_used ?? null,
    timeBudget: summary.time_budget ?? null,
    steps: summary.steps ?? steps.length,
    cluesFound: summary.clues_found ?? null,
    cluesTotal: summary.clues_total ?? null,
    cost: {
      narrator: summary.narrator_cost_usd ?? null,
      investigator: summary.investigator_cost_usd ?? null,
      judges: grades?.judge_cost_usd ?? null,
    },
    wallSeconds: summary.wall_seconds ?? null,
    judges: grades?.judges ?? null,
    mechanical: grades?.mechanical ?? null,
    readability: grades?.readability ?? null,
    findings: readFindings(result),
    turns: buildTurns(events, steps, clueText, readJson<Reading>(path.join(dir, "readability.json"))),
  };
}

async function readGameResult(dir: string): Promise<Result | null> {
  const file = path.join(dir, "result.json");
  return fs.existsSync(file) ? readResult(file) : null;
}

/** The run's `run.json`, or an error that says why this folder is not a self-play run. */
function readPlayRun(runDir: string): RunIndex {
  if (!fs.existsSync(path.join(runDir, "run.json"))) {
    throw new InputError(`${runDir} is not a run folder: it has no run.json`);
  }
  const index = readRunIndex(runDir);
  if (index.run.command !== "play") {
    throw new InputError(`${runDir} is a "${index.run.command}" run, not a "play" run`);
  }
  return index;
}

/** Everything the page shows, read from a run folder. */
export async function buildReportData(runDir: string, { repoRoot = process.cwd() }: { repoRoot?: string } = {}): Promise<ReportData> {
  const index = readPlayRun(runDir);
  // Games finish in any order, so a game's number is the one its summary
  // records, or the one a game that never started is named with.
  const subjects = index.subjects
    .map((subject, position) => {
      const summary = readJson<GameSummary>(path.join(runDir, subject.dir, "summary.json"));
      const named = Number(/^game-(\d+)$/.exec(subject.id)?.[1]);
      return { number: summary?.game_number ?? (named || position + 1), dir: path.join(runDir, subject.dir), summary };
    })
    .sort((a, b) => a.number - b.number);
  const played = subjects.filter((subject): subject is typeof subject & { summary: GameSummary } => subject.summary !== null);
  const first = played[0]?.summary;
  const blueprint = findBlueprint(played.map((subject) => subject.dir), first?.blueprint?.id, repoRoot);
  const clueText = clueTexts(blueprint);

  const games: ReportGame[] = [];
  for (const { number, dir, summary } of played) {
    games.push(buildGame(number, dir, summary, clueText, await readGameResult(dir)));
  }

  // A game that never started has no summary; its result says why.
  const failed: ReportData["failed"] = [];
  for (const subject of subjects.filter((entry) => entry.summary === null)) {
    const result = await readGameResult(subject.dir);
    failed.push({ number: subject.number, error: result?.run_error?.message ?? "the game did not run" });
  }

  return {
    run: path.basename(path.resolve(runDir)),
    title: first?.blueprint?.title ?? blueprint?.metadata?.title ?? "Playtest",
    persona: first?.persona ?? null,
    narratorModel: first?.narrator_model ?? null,
    investigatorModel: first?.investigator_model ?? null,
    targetAge: blueprint?.metadata?.target_age ?? null,
    games,
    failed,
  };
}

/** The page for a run's data: the template with the data inlined. */
export function renderReport(data: ReportData): string {
  // Inlined in a <script> element, so no "<" may survive to close it early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  const title = `${data.title} Playtest`.replace(/[&<>]/g, (c) => escapes[c]);
  return fs.readFileSync(TEMPLATE, "utf8")
    .replace("__REPORT_TITLE__", () => title)
    .replace("__REPORT_DATA__", () => json);
}

/** Writes <run>/report.html and returns its path. */
export async function writeReport(runDir: string, options: { repoRoot?: string } = {}): Promise<string> {
  const file = path.join(runDir, "report.html");
  fs.writeFileSync(file, renderReport(await buildReportData(runDir, options)));
  return file;
}
