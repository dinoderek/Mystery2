import { describe, expect, it } from "vitest";

import {
  buildDiscoveredClueIdSet,
  buildDiscoveryRecords,
  type ClueOriginWorld,
  eventRevealedClueIds,
} from "../../../packages/game-engine/src/clue-discovery.ts";

const notebookBlueprint: ClueOriginWorld = {
  world: {
    locations: [
      { id: "kitchen", name: "Kitchen", clues: [{ id: "loc-crumbs", text: "crumbs" }], sub_locations: [{ clues: [{ id: "loc-note", text: "a note" }] }] },
    ],
    characters: [
      { id: "alice", first_name: "Alice", clues: [{ id: "char-alice", text: "I saw it." }] },
    ],
  },
};

describe("eventRevealedClueIds", () => {
  it("reads the id array and the single search id from search/ask events", () => {
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
    expect(records[1]).toMatchObject({
      id: "char-alice",
      source: "talk",
      origin: { kind: "character", character_id: "alice", character_name: "Alice" },
      off_script: true,
    });
  });
});

describe("reading reveals from odd events", () => {
  it("finds nothing in an event with no payload, or a payload of the wrong shape", () => {
    expect(eventRevealedClueIds({ event_type: "search" })).toEqual([]);
    expect(eventRevealedClueIds({ event_type: "search", payload: null })).toEqual([]);
    expect(
      eventRevealedClueIds({
        event_type: "ask",
        payload: { revealed_clue_ids: "a", revealed_clue_id: 7 },
      }),
    ).toEqual([]);
  });

  it("skips ids that are blank or not text", () => {
    expect(
      eventRevealedClueIds({
        event_type: "ask",
        payload: { revealed_clue_ids: ["a", "", 3, null], revealed_clue_id: "" },
      }),
    ).toEqual(["a"]);
  });
});

describe("buildDiscoveryRecords over odd history", () => {
  it("skips events that reveal nothing and ids the blueprint does not know", () => {
    const records = buildDiscoveryRecords(notebookBlueprint, [
      { event_type: "move", payload: { revealed_clue_ids: ["loc-crumbs"] } },
      { event_type: "search", payload: { revealed_clue_ids: ["ghost", "loc-crumbs"] } },
      { event_type: "ask", payload: { revealed_clue_ids: ["loc-crumbs"] } },
    ]);

    expect(records.map((r) => [r.id, r.source, r.discovered_at])).toEqual([
      ["loc-crumbs", "search", null],
    ]);
  });
});
