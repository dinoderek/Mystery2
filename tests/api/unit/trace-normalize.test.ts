import { describe, expect, it } from "vitest";

import {
  TRACE_SCHEMA_VERSION,
  assertRawTrace,
  buildRawTrace,
} from "../../../evaluation/trace/lib/normalize.ts";
import { extractSessionTrace } from "../../../evaluation/trace/lib/datasource.ts";
import { readMockCaseGraph } from "../../testkit/src/mock-case.ts";
import { makeBlueprint, makeEvents, makeSession } from "./trace-fixtures";

/** A blueprint with no clue graph: the shape a V2 case had. */
const v2Blueprint = () => ({ id: "the-missing-heartwood", metadata: { title: "The Missing Heartwood" }, world: { locations: [], characters: [] } });

describe("buildRawTrace", () => {
  it("produces a versioned, sorted raw artifact", () => {
    const events = [...makeEvents()].reverse(); // unsorted on input
    const trace = buildRawTrace({
      session: makeSession(),
      events,
      blueprint: makeBlueprint(),
      source: { kind: "local", database: "/tmp/h/game.db" },
      extractedAt: "2026-06-02T00:00:00Z",
    });

    expect(trace.schema_version).toBe(TRACE_SCHEMA_VERSION);
    expect(trace.events.map((e: { sequence: number }) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The stored name, and the model of the events: every event but the start is served by a model.
    expect(trace.ai_profile).toEqual({ id: "default", model: "mock" });
  });

  it("lists every model a game's events carry, in the order they first appear", () => {
    const models = ["vendor/b", "vendor/a", "vendor/b"];
    const events = makeEvents()
      .slice(0, 3)
      .map((event, index) => ({ ...event, model: models[index] }));
    const trace = buildRawTrace({ session: makeSession(), events, blueprint: makeBlueprint() });
    expect(trace.ai_profile).toEqual({ id: "default", model: "vendor/b", models: ["vendor/b", "vendor/a"] });
  });

  it("records no model for a game with none, and no AI at all with no name either", () => {
    const events = makeEvents().map((event) => ({ ...event, model: null }));
    const named = buildRawTrace({ session: makeSession(), events, blueprint: makeBlueprint() });
    expect(named.ai_profile).toEqual({ id: "default" });
    const bare = buildRawTrace({ session: { ...makeSession(), ai_profile_id: null }, events, blueprint: makeBlueprint() });
    expect(bare.ai_profile).toBeNull();
  });

  it("carries the per-event model through, defaulting to null when absent", () => {
    const trace = buildRawTrace({
      session: makeSession(),
      events: makeEvents(),
      blueprint: makeBlueprint(),
      source: { kind: "local", database: "/tmp/h/game.db" },
    });
    const bySequence = (seq: number) =>
      trace.events.find((e: { sequence: number }) => e.sequence === seq);
    // Event 2 carries an AI-served model; event 1 (start) has none.
    expect(bySequence(2)?.model).toBe("mock");
    expect(bySequence(1)?.model).toBeNull();
  });

  it("rejects missing required inputs", () => {
    expect(() => buildRawTrace({ session: null, events: [], blueprint: {} })).toThrow(/session/);
    expect(() => buildRawTrace({ session: {}, events: {}, blueprint: {} })).toThrow(/events/);
    expect(() => buildRawTrace({ session: {}, events: [], blueprint: null })).toThrow(/blueprint/);
  });

  it("refuses a blueprint that is not a clue graph, by name", () => {
    expect(() => buildRawTrace({ session: makeSession(), events: makeEvents(), blueprint: v2Blueprint() })).toThrow(
      /blueprint the-missing-heartwood is not a clue-graph case/,
    );
    expect(() => buildRawTrace({ session: makeSession(), events: [], blueprint: { metadata: { title: "Old Tale" } } })).toThrow(
      /blueprint Old Tale is not a clue-graph case/,
    );
  });
});

describe("assertRawTrace", () => {
  it("accepts a well-formed trace and rejects malformed ones", () => {
    const trace = buildRawTrace({ session: makeSession(), events: makeEvents(), blueprint: makeBlueprint() });
    expect(assertRawTrace(trace)).toBe(trace);
    expect(() => assertRawTrace({})).toThrow(/schema_version/);
    expect(() => assertRawTrace({ schema_version: "x", session: {}, blueprint: makeBlueprint() })).toThrow(/events/);
  });

  it("refuses a stored trace of a blueprint that is not a clue graph, by name", () => {
    expect(() => assertRawTrace({ schema_version: "x", session: {}, blueprint: v2Blueprint(), events: [] })).toThrow(
      /Raw trace: blueprint the-missing-heartwood is not a clue-graph case/,
    );
  });
});

describe("extractSessionTrace", () => {
  const graphSession = () => ({ ...makeSession(), clue_graph_snapshot: JSON.stringify(readMockCaseGraph()) });

  it("orchestrates a source's session and events into a raw trace of the snapshot's case", async () => {
    const calls: string[] = [];
    const fakeSource = {
      databasePath: "/tmp/mystery/game.db",
      async fetchSession(id: string) {
        calls.push(`session:${id}`);
        return graphSession();
      },
      async fetchEvents(id: string) {
        calls.push(`events:${id}`);
        return makeEvents();
      },
    };

    const trace = await extractSessionTrace(fakeSource, "sess-1", { extractedAt: "2026-06-02T00:00:00Z" });
    expect(trace.session.id).toBe("sess-1");
    expect(trace.events).toHaveLength(9);
    expect(trace.source).toEqual({ kind: "local", database: "/tmp/mystery/game.db" });
    expect(trace.blueprint.clue_graph?.metadata.id).toBe("mock-case");
    expect(trace.clue_graph).toMatchObject({ format: "clue-graph/2", revision: 1 });
    expect(calls).toEqual(["session:sess-1", "events:sess-1"]);
  });

  it("refuses a game saved without a clue graph, naming the blueprint it played", async () => {
    const fakeSource = {
      async fetchSession() {
        return makeSession();
      },
      async fetchEvents() {
        return makeEvents();
      },
    };
    await expect(extractSessionTrace(fakeSource, "sess-1")).rejects.toThrow(
      /game sess-1 played blueprint bp-1, which is not a clue-graph case/,
    );
  });
});
