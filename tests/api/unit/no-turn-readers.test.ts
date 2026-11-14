// A refused line and `help` are saved as events of their own. Everything under
// evaluation/ that follows what the game master did must read a game the same
// with and without them: the trace exporter, the reconstruction, the mechanical
// checks, the reading-level score and the runtime cases cut from a trace.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NO_TURN_EVENT_TYPE } from "@my2/shared";
import { playedEvents } from "../../../evaluation/lib/game-events.mjs";
import { casesCommand } from "../../../evaluation/runtime/cases.ts";
import { scoreReadability } from "../../../evaluation/playtest/lib/judge.ts";
import { buildRawTrace } from "../../../evaluation/trace/lib/normalize.ts";
import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import { makeBlueprint, makeEvents, makeRawTrace, makeSession, type TraceEventRow } from "./trace-fixtures";

/** The line a player typed that the game answered without playing it. */
function lineThatCostNoTurn(sequence: number, input: string, answer: string): TraceEventRow {
  return {
    id: `n${sequence}`,
    sequence,
    event_type: NO_TURN_EVENT_TYPE,
    actor: "system",
    payload: { input, answered: "refused", reason: "unrecognized" },
    narration: answer,
    narration_parts: [
      { text: input, speaker: { kind: "investigator", key: "you", label: "You" } },
      { text: answer, speaker: { kind: "system", key: "system", label: "System" } },
    ],
    clues_revealed: [],
    created_at: "2026-06-01T10:00:30Z",
  };
}

/**
 * The same game as `makeEvents`, with such lines before the first event, in
 * the middle of the game and after the last; each later event is saved after
 * them, so its sequence is higher, as it would be in the database.
 */
function withLinesThatCostNoTurn(): TraceEventRow[] {
  const placed: TraceEventRow[] = [];
  const noise = (input: string) =>
    lineThatCostNoTurn(placed.length + 1, input, "Commands: move to/go to <location>, search, help.");
  const before = new Set([1, 4, 9]);
  for (const event of makeEvents()) {
    if (before.has(event.sequence)) placed.push(noise(`dance ${event.sequence}`));
    placed.push({ ...event, sequence: placed.length + 1 });
  }
  placed.push(noise("one more thing"));
  return placed;
}

/** The sequences of played events are where they sit among the played events. */
function bySequenceAmongPlayed(value: unknown, events: TraceEventRow[]): unknown {
  const rank = new Map(
    (playedEvents(events) as TraceEventRow[]).map((event, index): [number, number] => [event.sequence, index + 1]),
  );
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          key,
          key === "sequence" && typeof child === "number" ? (rank.get(child) ?? child) : walk(child),
        ]),
      );
    }
    return node;
  };
  return walk(value);
}

function traceOf(events: TraceEventRow[]) {
  return makeRawTrace({
    events: buildRawTrace({
      session: makeSession(),
      events,
      blueprint: makeBlueprint(),
      extractedAt: "2026-06-02T00:00:00Z",
      source: { kind: "local", database: "/tmp/h/game.db" },
    }).events,
  });
}

describe("readers of a game's events, with lines that cost no turn saved", () => {
  const without = makeEvents();
  const withLines = withLinesThatCostNoTurn();

  it("the fixture has them in it, shifting what comes after", () => {
    expect(withLines.filter((event) => event.event_type === NO_TURN_EVENT_TYPE)).toHaveLength(4);
    expect(withLines.at(-1)?.sequence).toBeGreaterThan(without.at(-1)!.sequence);
  });

  it("the trace exporter leaves them out", () => {
    const build = (events: TraceEventRow[]) =>
      buildRawTrace({
        session: makeSession(),
        events,
        blueprint: makeBlueprint(),
        extractedAt: "2026-06-02T00:00:00Z",
        source: { kind: "local", database: "/tmp/h/game.db" },
      });

    const exported = build(withLines);

    expect(exported.events.map((event: { event_type: string }) => event.event_type)).toEqual(
      build(without).events.map((event: { event_type: string }) => event.event_type),
    );
    expect(bySequenceAmongPlayed(exported, withLines)).toEqual(build(without));
  });

  it("the reconstruction is the same", () => {
    const reconstructed = reconstructTrace(makeRawTrace({ events: withLines }));

    expect(reconstructed.turns).toHaveLength(without.length);
    expect(bySequenceAmongPlayed(reconstructed, withLines)).toEqual(reconstructTrace(makeRawTrace({ events: without })));
  });

  it("the mechanical checks give the same verdicts", () => {
    const checked = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events: withLines }), context: { enforce_requires: true } });

    expect(checked).toHaveLength(3);
    expect(bySequenceAmongPlayed(checked, withLines)).toEqual(
      runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events: without }), context: { enforce_requires: true } }),
    );
  });

  it("the reading-level score counts only the game master's narration", () => {
    const score = (events: TraceEventRow[]) => scoreReadability(traceOf(events), 9);

    expect(score(withLines).narrations.length).toBe(score(without).narrations.length);
    expect(bySequenceAmongPlayed(score(withLines), withLines)).toEqual(score(without));
  });
});

describe("runtime cases cut from a trace", () => {
  let scratch: string | null = null;

  afterEach(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function cutCases(events: TraceEventRow[]): Promise<string> {
    scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "mystery-cases-from-trace-"));
    const dir = fs.mkdtempSync(path.join(scratch, "run-"));
    const tracePath = path.join(dir, "trace.json");
    const blueprint = { ...makeBlueprint(), id: "bp-1" };
    fs.writeFileSync(tracePath, JSON.stringify({ ...makeRawTrace({ events }), blueprint }));
    const code = await casesCommand.run([tracePath, "--out", path.join(dir, "cases"), "--types", "ask,talk,search"], {
      root: process.cwd(),
      out: () => {},
      err: (text) => {
        throw new Error(text);
      },
      env: {},
    });
    expect(code).toBe(0);
    // The blueprint's path names the scratch folder this run happened to use.
    return fs.readFileSync(path.join(dir, "cases", "trace.cases.json"), "utf8").replace(/"path": "[^"]*"/g, '"path": ""');
  }

  it("has no line that cost no turn in any case's history", async () => {
    const text = await cutCases(withLinesThatCostNoTurn());

    expect(text).not.toContain(NO_TURN_EVENT_TYPE);
    expect(text).not.toContain("dance");
    expect(text.replace(/"sequence": \d+/g, "").replace(/s\d+-/g, "s-")).toEqual(
      (await cutCases(makeEvents())).replace(/"sequence": \d+/g, "").replace(/s\d+-/g, "s-"),
    );
  });
});
