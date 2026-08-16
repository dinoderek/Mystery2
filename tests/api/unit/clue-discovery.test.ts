import { describe, expect, it } from "vitest";

import {
  buildDiscoveredClueIdSet,
  buildDiscoveryRecords,
  buildKnownCluesWithOrigin,
  buildPathCoverage,
  type CoverageBlueprint,
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
  it("builds ordered records with origin, source, and off-script flag", () => {
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
    });
    // Reasoning-path labels ("Main solution", "Red herring: ...") name the
    // answer, so they must never ride along on a player-facing record.
    expect(records[0]).not.toHaveProperty("threads");
    expect(records[1]).toMatchObject({
      id: "char-alice",
      source: "talk",
      origin: { kind: "character", character_id: "alice", character_name: "Alice Smith" },
      off_script: true,
    });
  });
});

describe("buildKnownCluesWithOrigin", () => {
  it("resolves ids to text plus provenance, preserving discovery order", () => {
    expect(
      buildKnownCluesWithOrigin(notebookBlueprint, ["char-alice", "loc-crumbs"]),
    ).toEqual([
      { id: "char-alice", text: "I saw it.", origin_label: "told by Alice Smith" },
      { id: "loc-crumbs", text: "crumbs", origin_label: "found at Kitchen" },
    ]);
  });

  it("gives sub-location clues their parent location's origin", () => {
    expect(buildKnownCluesWithOrigin(notebookBlueprint, ["loc-note"])).toEqual([
      { id: "loc-note", text: "a note", origin_label: "found at Kitchen" },
    ]);
  });

  it("drops duplicates and ids absent from the blueprint", () => {
    expect(
      buildKnownCluesWithOrigin(notebookBlueprint, [
        "loc-crumbs",
        "loc-crumbs",
        "ghost-clue",
      ]),
    ).toEqual([
      { id: "loc-crumbs", text: "crumbs", origin_label: "found at Kitchen" },
    ]);
  });
});

describe("buildPathCoverage", () => {
  const coverageBlueprint: CoverageBlueprint = {
    solution_paths: [
      {
        id: "path-solution",
        summary: "the crumbs solve it",
        location_clue_ids: ["loc-crumbs"],
        character_clue_ids: ["char-alice"],
      },
    ],
    red_herrings: [
      {
        id: "path-window",
        summary: "the open window",
        location_clue_ids: ["loc-note"],
        character_clue_ids: [],
      },
    ],
    suspect_elimination_paths: [],
  };

  it("splits each path's clues by what the investigator discovered", () => {
    expect(
      buildPathCoverage(coverageBlueprint, new Set(["loc-crumbs", "loc-note"])),
    ).toEqual([
      {
        path_id: "path-solution",
        kind: "solution",
        summary: "the crumbs solve it",
        found_clue_ids: ["loc-crumbs"],
        missing_clue_ids: ["char-alice"],
      },
      {
        path_id: "path-window",
        kind: "red_herring",
        summary: "the open window",
        found_clue_ids: ["loc-note"],
        missing_clue_ids: [],
      },
    ]);
  });

  it("reports every clue missing when nothing has been discovered", () => {
    const coverage = buildPathCoverage(coverageBlueprint, new Set());
    expect(coverage.every((entry) => entry.found_clue_ids.length === 0)).toBe(true);
    expect(coverage[0].missing_clue_ids).toEqual(["loc-crumbs", "char-alice"]);
  });
});
