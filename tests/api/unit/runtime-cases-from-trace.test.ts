import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readBlueprint } from "../../../evaluation/runtime/lib/case.ts";
import { played, readGraph } from "../../../evaluation/runtime/cases/clue-graph/support/play.ts";
import { getAction, normalizeHistory } from "../../../evaluation/runtime/lib/roles.ts";
import { buildRoleRequest } from "../../../evaluation/runtime/lib/prompt-build.ts";
import type { TemplateRoleInput } from "../../../packages/game-engine/src/role-request.ts";
import {
  actionForEvent,
  casesCommand,
  buildCase,
  historyPayload,
  sampleEvenly,
} from "../../../evaluation/runtime/cases.ts";
import { makeRawTrace } from "./trace-fixtures";

// These helpers turn a collected game-master trace into deterministic
// single-event runtime-eval cases. They run without a database or LLM, so we
// assert their pure output shape directly against small hand-built fixtures.

describe("sampleEvenly", () => {
  it("returns every item unchanged when there are at most `max`", () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    // Boundary: exactly `max` items are all kept.
    expect(sampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("picks evenly-spaced items that always include the first and last", () => {
    expect(sampleEvenly([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
    expect(sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 4, 8]);
  });

  it("de-duplicates when even spacing lands on the same item twice", () => {
    // Every sampled slot resolves to "a" or "b"; the result keeps one of each.
    expect(sampleEvenly(["a", "a", "b", "a", "a"], 3)).toEqual(["a", "b"]);
  });

  it("yields a single undefined slot when max is 1 over a larger array", () => {
    // With max === 1 the even-spacing divisor is zero, so the lone index is NaN
    // and reads past the array — documenting the current CLI behavior, which
    // never requests max === 1 in practice (the default cap is 3).
    const result = sampleEvenly([0, 1, 2, 3], 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeUndefined();
  });
});

describe("actionForEvent", () => {
  it("retains a targeted search query and an accusation's reasoning", () => {
    expect(actionForEvent({ event_type: "search", payload: { search_query: "the water butt" } })).toEqual({ type: "search", search_query: "the water butt" });
    expect(actionForEvent({ event_type: "accuse_failed", payload: { player_reasoning: "It was Toby." } })).toEqual({ type: "accuse", player_reasoning: "It was Toby." });
  });
  it("maps an ask event to an ask action carrying the player input", () => {
    expect(
      actionForEvent({ event_type: "ask", payload: { player_input: "who did it?" } }),
    ).toEqual({ type: "ask", player_input: "who did it?" });
  });

  it("defaults ask player_input to an empty string when the payload omits it", () => {
    expect(actionForEvent({ event_type: "ask", payload: {} })).toEqual({
      type: "ask",
      player_input: "",
    });
  });

  it("maps talk/move/search events to their action shapes", () => {
    expect(actionForEvent({ event_type: "talk", payload: { character_id: "c1" } })).toEqual({
      type: "talk",
      character_id: "c1",
    });
    expect(actionForEvent({ event_type: "move", payload: { destination: "l2" } })).toEqual({
      type: "move",
      destination: "l2",
    });
    expect(actionForEvent({ event_type: "search", payload: {} })).toEqual({ type: "search" });
  });

  it("tolerates an event with no payload at all", () => {
    expect(actionForEvent({ event_type: "search" })).toEqual({ type: "search" });
  });

  it("returns null for unsupported event types", () => {
    expect(actionForEvent({ event_type: "end_talk", payload: {} })).toEqual({ type: "end_talk" });
    expect(actionForEvent({ event_type: "clue_revealed", payload: {} })).toBeNull();
  });
});

it("reconstructs identical messages from engine-folded clue-graph history", async () => {
  const file = "blueprints/clue-graph/greenhouse-prizewinner.json";
  const graph = readGraph(file);
  const before = played(graph, [{ search: "the broken side window" }, { move: "potting_shed" }, { talk: "toby", narration: "Toby says he was at home." }, { say: "The glass fell outside, so nobody climbed in.", reply: "Toby drops the burglar story.", opened: ["toby_drops_burglar"] }]);
  const time = graph.metadata.time_budget - before.play.turns;
  const source = { mode: "talk", location_id: before.play.at, talk_character_id: "toby", time_remaining: time, history: before.history };
  const action = { type: "ask", player_input: "What happened next?" };
  const exported = buildCase({ sequence: 99, event_type: "ask", payload: { role: "graph_talk", character_id: "toby", location_id: before.play.at, player_input: action.player_input, diagnostics: { mode: "talk", time_before: time } } }, before.history.map((row, i) => ({ ...row, sequence: i + 1 })), file, []);
  const { blueprint } = await readBlueprint(file, process.cwd());
  const messages = (given: typeof exported.given) => buildRoleRequest(getAction("ask").roleInput(given, action, blueprint, normalizeHistory(given.history)) as unknown as TemplateRoleInput);
  // Compare the request after export with the original recorded state, including sequence.
  source.history = source.history.map((row, i) => ({ ...row, sequence: i + 1 }));
  expect(await messages(exported.given)).toEqual(await messages(source));
});

describe("historyPayload", () => {
  it("preserves the engine payload, including earned state and notebook lines", () => {
    const payload = { used_clue_ids: ["x"], used_quote: "the red marks", new_commitments: ["I saw it"], role: "graph_talk", clue_graph: { type: "line" }, notebook: { x: "Red marks." }, diagnostics: { mode: "talk" } };
    expect(historyPayload(payload)).toEqual(payload);
  });

  it("returns an empty object for an empty or nullish payload", () => {
    expect(historyPayload({})).toEqual({});
    expect(historyPayload(null)).toEqual({});
    expect(historyPayload(undefined)).toEqual({});
  });
});

describe("buildCase", () => {
  const blueprintPath = "evaluation/runtime/cases/from-traces/blueprints/bp.json";

  it("assembles a full case from a target event and its prior history", () => {
    const target = {
      sequence: 7,
      event_type: "ask",
      actor: "player",
      narration: "N",
      payload: {
        player_input: "who did it?",
        character_id: "c1",
        location_id: "l1",
        diagnostics: { mode: "talk", time_before: 42 },
      },
    };
    const prior = [
      {
        sequence: 1,
        event_type: "talk",
        actor: "player",
        narration: "t",
        payload: { character_id: "c1", stray_field: "drop me" },
      },
    ];

    const built = buildCase(target, prior, blueprintPath, ["flesch"]);

    expect(built).toEqual({
      id: "s7-ask",
      blueprint: { path: blueprintPath },
      given: {
        mode: "talk",
        location_id: "l1",
        talk_character_id: "c1",
        time_remaining: 42,
        history: [
          {
            sequence: 1,
            event_type: "talk",
            actor: "player",
            narration: "t",
            // The entire recorded payload survives the export.
            payload: { character_id: "c1", stray_field: "drop me" },
          },
        ],
      },
      action: { type: "ask", player_input: "who did it?" },
      judges: ["flesch"],
      judgeConfig: { flesch: { tolerance: 2 } },
    });
  });

  it("falls back to explore mode and a zero clock when diagnostics are absent", () => {
    const target = {
      sequence: 3,
      event_type: "search",
      payload: { location_id: "l9" },
    };

    const { given, id } = buildCase(target, [], blueprintPath, ["flesch"]);

    expect(id).toBe("s3-search");
    expect(given.mode).toBe("explore");
    expect(given.time_remaining).toBe(0);
    expect(given.history).toEqual([]);
    // No character on a search event -> no talk_character_id key at all.
    expect(given).not.toHaveProperty("talk_character_id");
  });

  it("prefers the payload's own time_remaining when diagnostics has none", () => {
    const target = {
      sequence: 4,
      event_type: "talk",
      payload: { location_id: "l1", character_id: "c2", time_remaining: 99 },
    };
    const { given } = buildCase(target, [], blueprintPath, ["flesch"]);
    expect(given.time_remaining).toBe(99);
    expect(given.talk_character_id).toBe("c2");
  });
});

describe("the cases command", () => {
  let scratch = "";
  afterEach(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = "";
  });

  const run = (tracePath: string, out: string) =>
    casesCommand.run([tracePath, "--out", out], { root: process.cwd(), out: () => {}, err: () => {}, env: {} });

  it("writes the trace's clue-graph case, which the harness reads back, beside the cases", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-cases-command-"));
    const tracePath = path.join(scratch, "trace.json");
    fs.writeFileSync(tracePath, JSON.stringify(makeRawTrace()));
    expect(await run(tracePath, path.join(scratch, "out"))).toBe(0);

    const cases = JSON.parse(fs.readFileSync(path.join(scratch, "out", "trace.cases.json"), "utf8"));
    expect(cases.length).toBeGreaterThan(0);
    const { blueprint } = await readBlueprint(cases[0].blueprint.path, process.cwd());
    expect(blueprint.clue_graph.metadata.id).toBe("mock-case");
  });

  it("writes the case at the age the game was played, which the trace's world view carries", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-cases-command-"));
    const tracePath = path.join(scratch, "trace.json");
    const trace = makeRawTrace();
    const authored = trace.blueprint.clue_graph!.metadata.target_age;
    const played = authored === 7 ? 8 : 7;
    fs.writeFileSync(tracePath, JSON.stringify({ ...trace, blueprint: { ...trace.blueprint, metadata: { ...trace.blueprint.metadata, target_age: played } } }));
    expect(await run(tracePath, path.join(scratch, "out"))).toBe(0);

    const cases = JSON.parse(fs.readFileSync(path.join(scratch, "out", "trace.cases.json"), "utf8"));
    const { blueprint } = await readBlueprint(cases[0].blueprint.path, process.cwd());
    expect(blueprint.clue_graph.metadata.target_age).toBe(played);
  });

  it("refuses a trace of a blueprint that is not a clue graph, by name, and writes nothing", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-cases-command-"));
    const tracePath = path.join(scratch, "trace.json");
    fs.writeFileSync(tracePath, JSON.stringify({ blueprint: { id: "the-missing-heartwood", world: {} }, events: [] }));

    await expect(run(tracePath, path.join(scratch, "out"))).rejects.toThrow(/blueprint the-missing-heartwood, which is not a clue-graph case/);
    expect(fs.existsSync(path.join(scratch, "out"))).toBe(false);
  });
});
