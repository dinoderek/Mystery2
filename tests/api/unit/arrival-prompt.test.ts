import { describe, expect, it } from "vitest";

import type { ConversationFragment } from "../../../packages/game-engine/src/ai-context.ts";
import { buildNarrationPrompt } from "../../../packages/game-engine/src/role-request.ts";
import { readMockCase, readMockCaseGraph } from "../../testkit/src/mock-case.ts";

// The mock case: the investigator starts in the kitchen, walks to the living
// room where Bob waits (s2), finds the score sheet there (s3), goes back to the
// kitchen (s4), and returns to the living room (s5).
const blueprint = readMockCase();
const graph = readMockCaseGraph();

const events: ConversationFragment[] = [
  { sequence: 1, event_type: "game_start", actor: "system", narration: "The cookies are gone.", payload: {} },
  {
    sequence: 2,
    event_type: "move",
    actor: "system",
    narration: "You step into the cosy living room, where Bob bends over a board game.",
    payload: { destination: "loc-living-room", location_id: "loc-living-room", clue_graph: { type: "move", location: "loc-living-room" } },
  },
  {
    sequence: 3,
    event_type: "search",
    actor: "system",
    narration: "You find a score sheet full of careful moves.",
    payload: {
      location_id: "loc-living-room",
      revealed_clue_id: "clue_score_sheet",
      revealed_clue_ids: ["clue_score_sheet"],
      clue_graph: { type: "search", notebook: { clue_score_sheet: "Bob's score sheet has a move every five minutes." } },
    },
  },
  {
    sequence: 4,
    event_type: "move",
    actor: "system",
    narration: "You head back to the kitchen.",
    payload: { destination: "loc-kitchen", location_id: "loc-kitchen", clue_graph: { type: "move", location: "loc-kitchen" } },
  },
  {
    sequence: 5,
    event_type: "move",
    actor: "system",
    narration: "You return to the living room.",
    payload: { destination: "loc-living-room", location_id: "loc-living-room", clue_graph: { type: "move", location: "loc-living-room" } },
  },
];

function arrivalAt(sequence: number): string {
  const event = events.find((entry) => entry.sequence === sequence)!;
  expect(event.event_type).toBe("move");
  return buildNarrationPrompt({
    role: "ambience",
    game_id: "stored",
    blueprint,
    destination_id: String(event.payload?.destination),
    conversation_history: events.filter((entry) => entry.sequence < sequence),
  });
}

const bob = graph.characters["char-bob"];

describe("the arrival prompt, on the mock case", () => {
  it.each([2, 5])("renders the living-room arrival at s%i in at most 5,000 characters", (sequence) => {
    expect(arrivalAt(sequence).length).toBeLessThanOrEqual(5000);
  });

  it("shows a present character from how they look and carry themselves, never what they know", () => {
    const prompt = arrivalAt(5);
    expect(prompt).toContain(bob.personality);
    for (const line of bob.appearance) expect(prompt).toContain(line);
    for (const known of bob.knows) expect(prompt).not.toContain(known.fact);
    for (const clue of Object.values(graph.clues)) {
      if (clue.kind !== "evidence" && clue.source.character === "char-bob") expect(prompt).not.toContain(clue.fact);
    }
  });

  it("states every fact of the place", () => {
    const prompt = arrivalAt(2);
    for (const fact of graph.locations["loc-living-room"].facts) expect(prompt).toContain(`- ${fact}`);
  });

  it("carries the first arrival's words on return, and not the finds since", () => {
    const first = events.find((entry) => entry.sequence === 2)!;
    const prompt = arrivalAt(5);
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain(JSON.stringify(first.narration));
    // s3 found the score sheet.
    expect(prompt).not.toContain("score sheet");
  });
});
