import { describe, expect, it } from "vitest";

import {
  buildDiscoveredClueIdSet,
  buildDiscoveryRecords,
  eventRevealedClueIds,
  isClueUnlocked,
  mapClueToThreads,
  type NotebookBlueprint,
} from "../../../supabase/functions/_shared/clue-discovery.ts";

const notebookBlueprint: NotebookBlueprint = {
  world: {
    locations: [
      { id: "kitchen", name: "Kitchen", clues: [{ id: "loc-crumbs", text: "crumbs" }], sub_locations: [{ clues: [{ id: "loc-note", text: "a note" }] }] },
    ],
    characters: [
      { id: "alice", first_name: "Alice", last_name: "Smith", clues: [{ id: "char-alice", text: "I saw it." }] },
    ],
  },
  solution_paths: [
    { summary: "the crumbs solve it", location_clue_ids: ["loc-crumbs"], character_clue_ids: ["char-alice"] },
  ],
  red_herrings: [
    { summary: "the open window", payoff: "the window was a draft", location_clue_ids: ["loc-note"], character_clue_ids: [] },
  ],
  suspect_elimination_paths: [],
};

describe("eventRevealedClueIds", () => {
  it("reads the v2 array and legacy single id from search/ask events", () => {
    expect(
      eventRevealedClueIds({
        event_type: "search",
        payload: { revealed_clue_ids: ["a", "b"], revealed_clue_id: "b" },
      }),
    ).toEqual(["a", "b"]);
    expect(
      eventRevealedClueIds({ event_type: "ask", payload: { revealed_clue_id: "c" } }),
    ).toEqual(["c"]);
  });

  it("ignores non-clue events", () => {
    expect(
      eventRevealedClueIds({ event_type: "move", payload: { revealed_clue_ids: ["x"] } }),
    ).toEqual([]);
  });
});

describe("buildDiscoveredClueIdSet", () => {
  it("unions reveals across all search/ask events", () => {
    const set = buildDiscoveredClueIdSet([
      { event_type: "search", payload: { revealed_clue_ids: ["a"] } },
      { event_type: "ask", payload: { revealed_clue_ids: ["b"], revealed_clue_id: "c" } },
      { event_type: "move", payload: {} },
    ]);
    expect([...set].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("isClueUnlocked", () => {
  it("treats ungated clues as always unlocked", () => {
    expect(isClueUnlocked({ id: "a" }, new Set())).toBe(true);
    expect(isClueUnlocked({ id: "a", requires: null }, new Set())).toBe(true);
  });

  it("requires every prerequisite to be discovered", () => {
    const clue = { id: "c", requires: { clue_ids: ["a", "b"], rationale: "r" } };
    expect(isClueUnlocked(clue, new Set(["a"]))).toBe(false);
    expect(isClueUnlocked(clue, new Set(["a", "b"]))).toBe(true);
  });
});

describe("mapClueToThreads", () => {
  it("labels clues by their mini-mystery membership", () => {
    expect(mapClueToThreads(notebookBlueprint, "loc-crumbs")).toEqual([
      { kind: "solution", label: "Main solution" },
    ]);
    expect(mapClueToThreads(notebookBlueprint, "loc-note")).toEqual([
      { kind: "red_herring", label: "Red herring: the window was a draft" },
    ]);
    expect(mapClueToThreads(notebookBlueprint, "unknown")).toEqual([]);
  });
});

describe("buildDiscoveryRecords", () => {
  it("builds ordered records with origin, source, off-script flag, and threads", () => {
    const records = buildDiscoveryRecords(notebookBlueprint, [
      { event_type: "search", payload: { revealed_clue_ids: ["loc-crumbs"] }, created_at: "t1" },
      { event_type: "ask", payload: { revealed_clue_ids: ["char-alice"], revealed_off_script: ["char-alice"] }, created_at: "t2" },
      // duplicate reveal of an already-seen clue is ignored
      { event_type: "search", payload: { revealed_clue_ids: ["loc-crumbs"] }, created_at: "t3" },
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: "loc-crumbs",
      source: "search",
      origin: { kind: "location", location_id: "kitchen", location_name: "Kitchen" },
      discovered_at: "t1",
      off_script: false,
      threads: [{ kind: "solution", label: "Main solution" }],
    });
    expect(records[1]).toMatchObject({
      id: "char-alice",
      source: "talk",
      origin: { kind: "character", character_id: "alice", character_name: "Alice Smith" },
      off_script: true,
    });
  });
});
