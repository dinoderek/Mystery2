import fs from "node:fs";

import { describe, expect, it } from "vitest";

import type { ConversationFragment } from "../../../packages/game-engine/src/ai-context.ts";
import { buildNarrationPrompt } from "../../../packages/game-engine/src/role-request.ts";

// The stored snow-foxes game: Howard and Barnaby (the culprit) wait on the
// platform, entered at s2 and returned to at s25.
const trace = JSON.parse(
  fs.readFileSync("evaluation/truth/games/large-snow-foxes-kid-7/trace.json", "utf8"),
) as { blueprint: Parameters<typeof buildNarrationPrompt>[0]["blueprint"]; events: ConversationFragment[] };

function arrivalAt(sequence: number): string {
  const event = trace.events.find((entry) => entry.sequence === sequence)!;
  expect(event.event_type).toBe("move");
  return buildNarrationPrompt({
    role: "ambience",
    game_id: "stored",
    blueprint: trace.blueprint,
    destination_id: String(event.payload?.destination),
    conversation_history: trace.events.filter((entry) => entry.sequence < sequence),
  });
}

const barnaby = trace.blueprint.world.characters.find((c) => c.id === "barnaby")!;

describe("the arrival prompt, on the stored snow-foxes game", () => {
  it.each([2, 25])("renders the platform arrival at s%i in at most 5,000 characters", (sequence) => {
    expect(arrivalAt(sequence).length).toBeLessThanOrEqual(5000);
  });

  it("plays the culprit's manner without anything he knows, did or claims", () => {
    const prompt = arrivalAt(25);
    expect(prompt).toContain(barnaby.initial_attitude_towards_investigator);
    expect(prompt).toContain("keeps attention away from himself");
    expect(prompt).toContain("would rather the investigator looked at Gus");
    // Steering at a thing in the room can point at the culprit's own hiding place.
    expect(prompt).toContain("never at a thing or spot here");
    for (const secret of [
      barnaby.stated_alibi!,
      barnaby.motive!,
      barnaby.background,
      ...barnaby.clues.map((clue) => clue.text),
      ...barnaby.actual_actions.map((step) => step.summary),
      ...barnaby.flavor_knowledge,
      ...(barnaby.agendas ?? []).map((agenda) => agenda.details),
      ...(barnaby.tells ?? []).map((tell) => tell.text),
    ]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it("carries the first arrival's words on return, and not the finds since", () => {
    const first = trace.events.find((entry) => entry.sequence === 2)!;
    const prompt = arrivalAt(25);
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain(JSON.stringify(first.narration));
    // s4 found Gus's songbook behind the water tower.
    expect(prompt).not.toContain("songbook");
  });
});
