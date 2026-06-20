import { describe, expect, it } from "vitest";

import {
  TRACE_SCHEMA_VERSION,
  assertRawTrace,
  buildRawTrace,
} from "../../../evaluation/trace/lib/normalize.mjs";
import { extractSessionTrace } from "../../../evaluation/trace/lib/datasource.mjs";
import { makeBlueprint, makeEvents, makeSession } from "./trace-fixtures";

describe("buildRawTrace", () => {
  it("produces a versioned, sorted, secret-free raw artifact", () => {
    const events = [...makeEvents()].reverse(); // unsorted on input
    const trace = buildRawTrace({
      session: makeSession(),
      events,
      blueprint: makeBlueprint(),
      aiProfile: { id: "default", provider: "openrouter", model: "x", openrouter_api_key: "sk-secret" },
      source: { kind: "supabase", api_url: "http://h" },
      extractedAt: "2026-06-02T00:00:00Z",
    });

    expect(trace.schema_version).toBe(TRACE_SCHEMA_VERSION);
    expect(trace.events.map((e: { sequence: number }) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(trace.ai_profile).toEqual({ id: "default", provider: "openrouter", model: "x" });
    expect(JSON.stringify(trace)).not.toContain("sk-secret");
  });

  it("rejects missing required inputs", () => {
    expect(() => buildRawTrace({ session: null, events: [], blueprint: {} })).toThrow(/session/);
    expect(() => buildRawTrace({ session: {}, events: {}, blueprint: {} })).toThrow(/events/);
    expect(() => buildRawTrace({ session: {}, events: [], blueprint: null })).toThrow(/blueprint/);
  });
});

describe("assertRawTrace", () => {
  it("accepts a well-formed trace and rejects malformed ones", () => {
    const trace = buildRawTrace({ session: makeSession(), events: makeEvents(), blueprint: makeBlueprint() });
    expect(assertRawTrace(trace)).toBe(trace);
    expect(() => assertRawTrace({})).toThrow(/schema_version/);
    expect(() => assertRawTrace({ schema_version: "x", session: {}, blueprint: {} })).toThrow(/events/);
  });
});

describe("extractSessionTrace", () => {
  it("orchestrates a source's four methods into a raw trace", async () => {
    const calls: string[] = [];
    const fakeSource = {
      url: "http://localhost:54321",
      async fetchSession(id: string) {
        calls.push(`session:${id}`);
        return makeSession();
      },
      async fetchEvents(id: string) {
        calls.push(`events:${id}`);
        return makeEvents();
      },
      async downloadBlueprint(id: string) {
        calls.push(`blueprint:${id}`);
        return makeBlueprint();
      },
      async fetchProfile(id: string) {
        calls.push(`profile:${id}`);
        return { id, provider: "mock", model: "mock" };
      },
    };

    const trace = await extractSessionTrace(fakeSource, "sess-1", { extractedAt: "2026-06-02T00:00:00Z" });
    expect(trace.session.id).toBe("sess-1");
    expect(trace.events).toHaveLength(9);
    expect(trace.source).toEqual({ kind: "supabase", api_url: "http://localhost:54321" });
    expect(calls).toEqual(["session:sess-1", "events:sess-1", "blueprint:bp-1", "profile:default"]);
  });
});
