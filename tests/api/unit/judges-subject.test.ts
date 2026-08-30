import { describe, expect, it } from "vitest";

import {
  projectInteractionSubject,
  projectTraceSubject,
  revealedClueIdsFromResponse,
} from "../../../evaluation/judges/subject.mjs";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.mjs";
import { makeRawTrace } from "./trace-fixtures";

// Both harnesses project into ONE subject shape so the same judge brief grades
// a whole played session and a single replayed interaction. These tests pin the
// part that differs between them: which turns are judged.

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "ask-alice",
    blueprint_path: "blueprints/mock-blueprint.json",
    given: {
      mode: "talk",
      location_id: "loc-kitchen",
      talk_character_id: "char-alice",
      history: [
        {
          event_type: "talk",
          actor: "system",
          narration: "Alice looks up from the counter.",
          payload: { character_id: "char-alice" },
        },
        {
          event_type: "ask",
          actor: "system",
          narration: '"I never went near the jar," Alice says.',
          payload: {
            character_id: "char-alice",
            player_input: "Did you take the cookies?",
            revealed_clue_ids: ["clue-crumb"],
          },
        },
      ],
    },
    action: { type: "ask", player_input: "Then why are your hands shaking?" },
    response: {
      narration_text: '"They are not!" Alice says, sitting on her hands.',
      raw: { narration: "…", revealed_clue_ids: ["clue-wrapper"], revealed_off_script: [] },
    },
    ...overrides,
  };
}

describe("projectInteractionSubject", () => {
  it("judges only the action under test and keeps the fixture history as context", () => {
    const subject = projectInteractionSubject(makeInteraction(), {
      roleName: "talk_conversation",
    });

    expect(subject.subject_kind).toBe("interaction");
    expect(subject.turns).toHaveLength(3);
    // The case AUTHORED the first two turns — the model did not write them, so
    // a judge must never report findings against them.
    expect(subject.turns.slice(0, 2).every((t: { judged: boolean }) => t.judged)).toBe(false);
    expect(subject.judged_sequences).toEqual([3]);
    expect(subject.turns[2].narration).toContain("They are not!");
    expect(subject.turns[2].player_input).toBe("Then why are your hands shaking?");
  });

  it("reads history rows with the same event readers a real trace uses", () => {
    const subject = projectInteractionSubject(makeInteraction(), { roleName: "talk_conversation" });
    expect(subject.turns[0].role_name).toBe("talk_start");
    expect(subject.turns[1].role_name).toBe("talk_conversation");
    expect(subject.turns[1].revealed_clue_ids).toEqual(["clue-crumb"]);
    expect(subject.turns[1].character_id).toBe("char-alice");
  });

  it("accumulates prior reveals so a gated clue can be judged", () => {
    const subject = projectInteractionSubject(makeInteraction(), { roleName: "talk_conversation" });
    expect(subject.turns[0].prior_revealed_clue_ids).toEqual([]);
    // The judged turn knows exactly what the player walked in holding.
    expect(subject.turns[2].prior_revealed_clue_ids).toEqual(["clue-crumb"]);
    expect(subject.turns[2].revealed_clue_ids).toEqual(["clue-wrapper"]);
  });

  it("marks the accusation phase, where discussing the solution is legitimate", () => {
    const subject = projectInteractionSubject(
      makeInteraction({ action: { type: "accuse", player_reasoning: "It was Alice." } }),
      { roleName: "accusation_judge", isAccusationPhase: true },
    );
    expect(subject.turns.at(-1)).toMatchObject({
      judged: true,
      is_accusation_phase: true,
      player_input: "It was Alice.",
    });
  });

  it("handles a case with no prior history", () => {
    const subject = projectInteractionSubject(
      makeInteraction({ given: { mode: "explore", location_id: "loc-kitchen", history: [] } }),
      { roleName: "intro" },
    );
    expect(subject.turns).toHaveLength(1);
    expect(subject.judged_sequences).toEqual([1]);
  });
});

describe("revealedClueIdsFromResponse", () => {
  // The two backends report the model's clue decisions differently, and the
  // judge needs the same list from either.
  it("reads the endpoint backend's accepted clue objects", () => {
    expect(
      revealedClueIdsFromResponse({
        raw: { revealed_clues: [{ id: "clue-crumb", text: "…" }, { id: "clue-wrapper" }] },
      }),
    ).toEqual(["clue-crumb", "clue-wrapper"]);
  });

  it("reads the cli backend's raw role output, for talk and for search", () => {
    expect(revealedClueIdsFromResponse({ raw: { revealed_clue_ids: ["clue-crumb"] } })).toEqual([
      "clue-crumb",
    ]);
    expect(revealedClueIdsFromResponse({ raw: { revealed_clue_id: "clue-wrapper" } })).toEqual([
      "clue-wrapper",
    ]);
  });

  it("is empty when the turn revealed nothing", () => {
    expect(revealedClueIdsFromResponse({ raw: { narration: "…" } })).toEqual([]);
    expect(revealedClueIdsFromResponse({ raw: { revealed_clue_id: null } })).toEqual([]);
    expect(revealedClueIdsFromResponse({})).toEqual([]);
  });
});

describe("projectTraceSubject", () => {
  it("judges every turn and drops turns with no game-master role", () => {
    const subject = projectTraceSubject(reconstructTrace(makeRawTrace()).turns);
    expect(subject.subject_kind).toBe("trace");
    expect(subject.turns.every((t: { judged: boolean }) => t.judged)).toBe(true);
    expect(subject.turns.every((t: { role_name: string | null }) => t.role_name !== null)).toBe(true);
  });

  it("flags accusation turns so the spoiler judge stops at the endgame", () => {
    const subject = projectTraceSubject(reconstructTrace(makeRawTrace()).turns);
    const accusation = subject.turns.filter(
      (t: { is_accusation_phase: boolean }) => t.is_accusation_phase,
    );
    expect(accusation.length).toBeGreaterThan(0);
    for (const turn of accusation) {
      expect(String(turn.role_name)).toMatch(/^accusation_/);
    }
  });
});
