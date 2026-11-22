// The second clue-graph story, written to exercise what the greenhouse cannot:
// a false alibi given for someone else, a conclusion that falls when it is
// taken back, and a hidden spot (`docs/clue-graph.md`). Graph and engine, no
// model.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cheapestRoute, reachClues, validateClueGraph, type ClueGraphCase } from "@my2/shared";
import {
  applyEvent,
  replay,
  startPlay,
  supportedConclusions,
  visibleSpots,
  type ClueGraphEvent,
  type ClueGraphPlay,
} from "../../../packages/game-engine/src/clue-graph/play.ts";
import { deriveClueGraph } from "../../../packages/game-engine/src/clue-graph/leads.ts";

const FILE = "blueprints/clue-graph/dragon-crown.json";
const graph: ClueGraphCase = validateClueGraph(JSON.parse(fs.readFileSync(FILE, "utf8")));

const line = (character: string, report: Partial<Omit<Extract<ClueGraphEvent, { type: "line" }>, "type" | "character">>) =>
  ({ type: "line", character, opened: [], asked: [], seen: [], ...report }) as ClueGraphEvent;
const move = (location: string): ClueGraphEvent => ({ type: "move", location });
const search = (spot?: string): ClueGraphEvent => (spot === undefined ? { type: "search" } : { type: "search", spot });

/** Sam's alibi for Nina, heard on first meeting. */
const SAM_MET: ClueGraphEvent[] = [move("library"), { type: "talk", character: "sam" }];
/** The sign-in sheet shown to Sam: he takes the alibi back. */
const SAM_RETRACTS: ClueGraphEvent[] = [move("library"), search("the sign-in sheet on the desk"), { type: "talk", character: "sam" }, line("sam", { opened: ["sam_retracts"] })];
/** Mr. Pike, met with the script cards found. */
const PIKE_MET: ClueGraphEvent[] = [move("playground"), search("behind the bike shed"), { type: "talk", character: "pike" }];

function conclusionsAfter(events: ClueGraphEvent[]): string[] {
  return deriveClueGraph(graph, events).conclusions;
}

describe("the dragon-crown clue graph", () => {
  it("passes the schema and the validator, and its culprit has a route within the turn budget", () => {
    expect(graph.metadata.time_budget).toBe(10);
    const rule = graph.conclusions.culprit_leo.rule;
    expect(cheapestRoute(graph, rule)).toBeLessThanOrEqual(graph.metadata.time_budget);
  });

  it("holds a false statement that covers another character, and a clue that takes it back", () => {
    const alibi = graph.clues.sam_alibi_nina;
    if (alibi.kind !== "statement") throw new Error("The alibi is a statement");
    expect(alibi.truth).toBe(false);
    expect(alibi.source).toEqual({ character: "sam" });
    expect(alibi.fact).toContain("Nina");
    expect(alibi.reached).toEqual({ by: "first_meeting" });
    // The one it covers is a suspect who never said it herself.
    expect(graph.characters.nina.role).toBe("suspect");
    expect(graph.characters.sam.role).toBe("witness");
    const retraction = graph.clues.sam_retracts;
    if (retraction.kind !== "statement") throw new Error("The retraction is a statement");
    expect(retraction.takes_back).toEqual(["sam_alibi_nina"]);
    expect(retraction.reached.by).toBe("gated");
    expect(reachClues(graph).map((entry) => entry.id)).toContain("sam_retracts");
  });

  it("clears Nina on the alibi alone, a conclusion that falls when Sam takes it back", () => {
    expect(graph.conclusions.nina_alibi_early).toMatchObject({ clears: "nina", rule: { all: ["sam_alibi_nina"] } });
    expect(conclusionsAfter(SAM_MET)).toContain("nina_alibi_early");
    const afterRetraction = deriveClueGraph(graph, SAM_RETRACTS);
    expect(afterRetraction.play.retracted).toEqual(["sam_alibi_nina"]);
    expect(afterRetraction.conclusions).not.toContain("nina_alibi_early");
    // The alibi still counts as heard: the notebook shows it, taken back.
    expect(afterRetraction.notebook.find((entry) => entry.id === "sam_alibi_nina")?.taken_back).toBe(true);
  });

  it("clears Nina for good on Mr. Pike's sighting and the script cards, which the retraction leads to", () => {
    const solid = [
      ...SAM_RETRACTS,
      ...PIKE_MET,
      line("pike", { asked: ["clue_pike_saw_nina"] }),
    ];
    const conclusions = conclusionsAfter(solid);
    expect(conclusions).toContain("nina_cleared");
    expect(conclusions).not.toContain("nina_alibi_early");
  });

  it("hides the spot behind the dragon until Mr. Pike's sighting points to it", () => {
    const spots = (play: ClueGraphPlay) => visibleSpots(graph, play, "art_room");
    const pointer = graph.locations.art_room.spots.find((spot) => spot.revealed_by)!;
    expect(pointer.revealed_by).toBe("clue_pike_saw_bundle");
    expect(graph.clues.clue_pike_saw_bundle.fact).toContain("behind the big paper dragon");
    expect(reachClues(graph).map((entry) => entry.id)).toEqual(expect.arrayContaining(["clue_pike_saw_bundle", "clue_crown_behind_dragon"]));

    const before = replay(graph, [move("art_room")]);
    expect(spots(before)).toEqual(["the paint shelf", "the drying rack"]);
    // Naming it first finds nothing.
    const named = applyEvent(graph, before, search("behind the big paper dragon"));
    expect(named.revealed).toEqual([]);

    const told = replay(graph, [...PIKE_MET, line("pike", { asked: ["clue_pike_saw_bundle"] }), move("art_room")]);
    expect(told.held).toContain("clue_pike_saw_bundle");
    expect(spots(told)).toContain("behind the big paper dragon");
    const found = applyEvent(graph, told, search("behind the big paper dragon"));
    expect(found.revealed).toEqual(["clue_crown_behind_dragon"]);
    expect(supportedConclusions(graph, found.play)).toContain("culprit_leo");
    expect(startPlay(graph).held).toEqual([]);
  });

  it("is won on the crown found where Mr. Pike saw it hidden, and lost on Nina", () => {
    const won = conclusionsAfter([
      ...PIKE_MET,
      line("pike", { asked: ["clue_pike_saw_bundle"] }),
      move("art_room"),
      search("behind the big paper dragon"),
    ]);
    expect(won).toContain("culprit_leo");
    expect(conclusionsAfter(SAM_MET)).not.toContain("culprit_leo");
  });

  it("gives Leo a way to be cornered: both cracks out, then a plain question", () => {
    const cracked = [
      move("hall"),
      search("the stage steps"),
      move("playground"),
      search("behind the bike shed"),
      move("art_room"),
      { type: "talk", character: "leo" } as ClueGraphEvent,
      line("leo", { opened: ["leo_drops_nina", "leo_admits_hall"] }),
    ];
    expect(conclusionsAfter(cracked)).not.toContain("culprit_leo");
    const confessed = deriveClueGraph(graph, [...cracked, line("leo", { opened: ["leo_confession"] })]);
    expect(confessed.play.retracted).toEqual(expect.arrayContaining(["leo_blames_nina", "leo_alibi"]));
    expect(confessed.conclusions).toContain("culprit_leo");
  });
});
