/**
 * `cases <trace>`: turns a played game into cases.
 *
 * A trace (from `judge game` or the trace extractor) bundles the full
 * blueprint, the final session and the ordered event stream. Every event's
 * payload self-describes the exact state it was generated from
 * (diagnostics.mode, diagnostics.time_before, location_id, character_id,
 * player_input, revealed_clue_ids), so each target event becomes one case:
 *
 *   given  = that pre-event state and ALL prior events as fixed history
 *   action = the event itself (ask, talk, move, search)
 *
 * which is exactly the deterministic single-event shape `judge turn` replays.
 * The cases and the trace's blueprint are written under `--out`, else under
 * `<output root>/cases/<trace>/`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { resolveOutputRoot } from "../core/run-folder.ts";
import { playedEvents } from "../lib/game-events.ts";
import type { TurnAction, TurnCase } from "./lib/case.ts";

/** A persisted event, as a trace holds it. */
export interface TraceEvent {
  sequence: number;
  event_type: string;
  actor?: string;
  narration?: string;
  payload?: Record<string, unknown> | null;
}

// Trim a trace event's payload to the fields the runtime context builder reads
// for history (keeps generated cases readable without losing fidelity).
export function historyPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of [
    "player_input", "character_id", "character_name", "location_id",
    "location_name", "destination", "revealed_clue_ids", "revealed_clue_id",
  ]) {
    if (payload?.[k] !== undefined) keep[k] = payload[k];
  }
  return keep;
}

function toFragment(event: TraceEvent) {
  return {
    sequence: event.sequence,
    event_type: event.event_type, // keep verbatim ("ask"/"talk"/"end_talk"/...)
    actor: event.actor ?? "system",
    narration: event.narration ?? "",
    payload: historyPayload(event.payload ?? {}),
  };
}

// Build the `action` for a target event, or null if the type isn't supported.
export function actionForEvent(event: Pick<TraceEvent, "event_type" | "payload">): TurnAction | null {
  const p = (event.payload ?? {}) as Record<string, string>;
  switch (event.event_type) {
    case "ask": return { type: "ask", player_input: p.player_input ?? "" };
    case "talk": return { type: "talk", character_id: p.character_id };
    case "move": return { type: "move", destination: p.destination };
    case "search": return { type: "search" };
    default: return null;
  }
}

// Pick up to `max` items, evenly spaced across the array (first..last).
export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return [...new Set(out)];
}

export function buildCase(event: TraceEvent, priorEvents: TraceEvent[], blueprintPath: string, judges: string[]): TurnCase {
  const p = (event.payload ?? {}) as Record<string, unknown> & { diagnostics?: Record<string, unknown> };
  const diag = p.diagnostics ?? {};
  const given = {
    mode: (diag.mode as string | undefined) ?? "explore",
    location_id: p.location_id as string | undefined,
    ...(p.character_id ? { talk_character_id: p.character_id as string } : {}),
    time_remaining: ((diag.time_before ?? p.time_remaining ?? 0) as number),
    history: priorEvents.map(toFragment),
  };
  return {
    id: `s${event.sequence}-${event.event_type}`,
    blueprint: { path: blueprintPath },
    given,
    action: actionForEvent(event) as TurnAction,
    judges,
    judgeConfig: { flesch: { tolerance: 2 } },
  };
}

const HELP = formatHelp({
  usage: "cases <trace>",
  summary:
    "Turns a played game into cases: each chosen event becomes one case with every earlier event as fixed history. " +
    "Writes the cases and the trace's blueprint, which `judge turn` replays.",
  options: [
    ["--out <dir>", "where to write (default: <output root>/cases/<trace>)"],
    ["--types <list>", "event types to turn into cases (default: ask,talk)"],
    ["--max <n>", "cap cases per type, sampled evenly across the session (default: 3)"],
    ["--judges <list>", "judges for the generated cases (default: flesch)"],
  ],
});

const SPEC = {
  options: {
    out: { type: "string" },
    types: { type: "string" },
    max: { type: "string" },
    judges: { type: "string" },
  },
  positionals: { min: 1, max: 1 },
} as const;

function csv(value: OptionValue, fallback: string): string[] {
  return (typeof value === "string" ? value : fallback).split(",").map((s) => s.trim()).filter(Boolean);
}

function positiveInteger(value: OptionValue, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} needs a positive integer, got "${String(value)}"`);
  return n;
}

interface Trace {
  blueprint: { id: string; metadata?: { title?: string; target_age?: number } };
  events: TraceEvent[];
}

async function readTrace(file: string): Promise<Trace> {
  let trace: Trace;
  try {
    trace = JSON.parse(await fs.readFile(file, "utf8")) as Trace;
  } catch (error) {
    throw new UsageError(`cannot read trace ${file}: ${(error as Error).message}`);
  }
  if (!trace.blueprint?.id || !Array.isArray(trace.events)) {
    throw new UsageError("Not a trace file: expected { blueprint: { id }, events: [...] }");
  }
  return trace;
}

/** The cases a trace yields: up to `max` events of each type, in sequence order. */
export function casesFromTrace(trace: Trace, types: string[], max: number, blueprintPath: string, judges: string[]): TurnCase[] {
  const events = (playedEvents(trace.events) as TraceEvent[]).sort((a, b) => a.sequence - b.sequence);
  const cases: TurnCase[] = [];
  for (const type of types) {
    for (const event of sampleEvenly(events.filter((e) => e.event_type === type), max)) {
      if (!actionForEvent(event)) continue;
      cases.push(buildCase(event, events.filter((e) => e.sequence < event.sequence), blueprintPath, judges));
    }
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function describeCase(c: TurnCase): string {
  const a = c.action;
  const detail = a.type === "ask" ? JSON.stringify(a.player_input)
    : a.type === "talk" ? String(a.character_id)
    : a.type === "move" ? `-> ${a.destination}` : "";
  return `  ${c.id.padEnd(14)} history=${String(c.given.history?.length ?? 0).padStart(2)}  ${detail}`;
}

export const casesCommand: EvalCommand = {
  name: "cases",
  summary: "turn a played game into cases",
  help: HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, SPEC);
    if (common.help) {
      context.out(HELP);
      return 0;
    }
    const tracePath = path.resolve(positionals[0]);
    const types = csv(values.types, "ask,talk");
    const max = positiveInteger(values.max, 3, "--max");
    const judges = csv(values.judges, "flesch");
    const trace = await readTrace(tracePath);

    const traceId = path.basename(tracePath).replace(/\.json$/, "");
    const outDir = typeof values.out === "string"
      ? path.resolve(values.out)
      : path.join(resolveOutputRoot(common.outputRoot, context.env), "cases", traceId);

    // The blueprint is written beside the cases so they can name it by path.
    const blueprintsDir = path.join(outDir, "blueprints");
    await fs.mkdir(blueprintsDir, { recursive: true });
    const blueprintFile = path.join(blueprintsDir, `${trace.blueprint.id}.json`);
    await fs.writeFile(blueprintFile, `${JSON.stringify(trace.blueprint, null, 2)}\n`);

    const cases = casesFromTrace(trace, types, max, blueprintFile, judges);
    const outFile = path.join(outDir, `${traceId}.cases.json`);
    await fs.writeFile(outFile, `${JSON.stringify(cases, null, 2)}\n`);

    context.out(`[cases] ${cases.length} case(s) -> ${outFile}`);
    context.out(`[cases] blueprint -> ${blueprintFile} (target_age ${trace.blueprint.metadata?.target_age})`);
    for (const c of cases) context.out(describeCase(c));
    return 0;
  },
};
