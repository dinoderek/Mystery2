import fs from "node:fs";

import { describe, expect, it } from "vitest";

import type { ConversationFragment } from "../../../packages/game-engine/src/ai-context.ts";
import { loadPromptTemplate } from "../../../packages/game-engine/src/ai-prompts.ts";
import { allRoleRequestNames, buildNarrationPrompt, buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import {
  buildTalkConversationTemplate,
  FULL_TALK_PROFILE,
  talkPromptProfile,
} from "../../../packages/game-engine/src/talk-prompt.ts";

// The stored snow-foxes game, in which Barnaby swung between two stories.
const trace = JSON.parse(
  fs.readFileSync("tests/api/unit/fixtures/snow-foxes-trace.json", "utf8"),
) as { blueprint: Parameters<typeof buildRoleRequest>[0]["blueprint"]; events: ConversationFragment[] };

async function talkAt(sequence: number, characterId: string, locationId: string) {
  const event = trace.events.find((entry) => entry.sequence === sequence)!;
  return buildRoleRequest({
    role: "talk_conversation",
    game_id: "stored",
    session: { mode: "talk", current_location_id: locationId, current_talk_character_id: characterId, time_remaining: 5 },
    blueprint: trace.blueprint,
    character_id: characterId,
    location_id: locationId,
    player_input: String(event.payload?.player_input ?? "Where were you at ten past three?"),
    conversation_history: trace.events.filter((entry) => entry.sequence < sequence),
  });
}

const AGENDA_SECTIONS = [
  "Your agendas shape how you answer",
  "## Protecting yourself",
  "## Protecting someone",
  "## Blaming someone",
  "## Held-back clues",
];

describe("the talk_conversation prompt, assembled by character", () => {
  it("renders Barnaby's turn 28 from the stored trace in at most 5,500 characters", async () => {
    const { prompt } = await talkAt(28, "barnaby", "platform");
    expect(prompt.length).toBeLessThanOrEqual(5500);
    expect(prompt).toContain("You are Barnaby");
    expect(prompt).toContain("the prints were snowshoes not wolf paws");
    // An earned reaction outranks the agenda it touches: no blaming Gus again.
    expect(prompt).toContain("current_story outranks them");
    expect(prompt).toContain("and never once current_story backs off the blame");
  });

  it("leaves out every agenda section for a character with no agendas", async () => {
    // Bramble has no agendas; her one lock is a pointer.
    const bramble = trace.blueprint.world.characters.find((c) => c.id === "bramble")!;
    expect(bramble.agendas ?? []).toEqual([]);
    const { prompt } = await talkAt(15, "bramble", "tea_house");
    for (const section of AGENDA_SECTIONS) expect(prompt).not.toContain(section);
    expect(prompt).toContain("## A willing witness");
    expect(prompt.split("Share a clue when it answers the question").length - 1).toBe(1);
    expect(prompt).toContain('"requires_kind" pointer');
    expect(prompt).not.toContain('"requires_kind" leverage');
  });

  it("carries only the sections Barnaby's agendas, locks and tells call for", async () => {
    const { prompt } = await talkAt(28, "barnaby", "platform");
    expect(prompt).toContain("## Protecting yourself");
    expect(prompt).toContain("## Blaming someone");
    expect(prompt).not.toContain("## Protecting someone");
    expect(prompt).not.toContain("## Held-back clues");
    // His only clue is unlocked.
    expect(prompt).not.toContain("## Locked clues");
    // His tells are condition and clue tells, and the fallback is not open.
    expect(prompt).toContain('- "clue": only when that clue is used');
    expect(prompt).not.toContain('- "always"');
    expect(prompt).not.toContain("## Repeated asking");
    expect(prompt).not.toContain("## A willing witness");
  });

  it("names only the conditions and lock kinds the character has", async () => {
    // Gus: a confronted-with-evidence reveal behind a leverage lock.
    const { prompt } = await talkAt(28, "gus", "luggage_car");
    expect(prompt).toContain("## Held-back clues");
    expect(prompt).toContain("- confronted_with_evidence:");
    expect(prompt).not.toContain("- trust_established:");
    expect(prompt).toContain('"requires_kind" leverage');
    expect(prompt).not.toContain('"requires_kind" pointer');
  });

  it("opens the repeated-asking section only once the engine's count does", () => {
    const shut = talkPromptProfile({ state: { fallback_open: false } });
    const open = talkPromptProfile({ state: { fallback_open: true } });
    expect(buildTalkConversationTemplate(shut)).not.toContain("## Repeated asking");
    expect(buildTalkConversationTemplate(open)).toContain('"state.fallback_open" is true');
  });

  it("asks for reported use only when the character has clues to use", () => {
    const none = buildTalkConversationTemplate(talkPromptProfile({}));
    expect(none).not.toContain("## Using a clue");
    expect(none).not.toContain('"gate_clues"');
    const gated = buildTalkConversationTemplate(talkPromptProfile({ gate_clues: [{ id: "c" }] }));
    expect(gated).toContain("## Using a clue");
    expect(gated).toContain('Put the "gate_clues" ids used this turn in "used_clue_ids"');
  });
});

// Each of these is a rule. Wherever it is included, it is stated once.
const RULES = [
  "Using a clue means",
  "Share a clue when it answers the question",
  "Saying a word from it, or holding it, is not enough",
  "Naming you as the culprit",
  "Never take a reaction back",
  "current_story outranks them",
  "never once current_story backs off the blame",
  "never make one that contradicts current_story",
  "Raise your alibi only when asked where you were or when",
  "concede what its \"shows\" says",
  "A use is a fact about their words",
  "Once it is used, give the clue that turn",
  "is null until all its parts are earned",
  "a precondition, never permission",
  "unless the reason is a physical gate",
  "Never show an untriggered tell's cue",
  "never a confession",
  "never listed again",
  "If the line is gibberish",
  "first-person dialogue",
  "never invent more",
  "Choose pronouns",
  "the reading level wins",
  "years old",
];

// Pairs of rules that disagree. The first of each is what the prompt used to
// say; the two never appear together.
const CONFLICTS: Array<[string, string]> = [
  ["Your stated alibi still holds", "Never take a reaction back"],
  ["reinforce your stated", "concede what its"],
  ["not just possess it", "holding it, is not enough"],
  ["prereqs_met", "never permission"],
  ["3+ times", "fallback_open"],
  ["No part earned: stay in control", "hold to current_story"],
  ["Use actual_actions (ordered timeline) to stay consistent", "Keep to actual_actions, the parts of your day you will speak of"],
  // An earned part used to be bent to fit the alibi, and a re-pressed clue read as a repeated push.
  ["fitted into your story", "even where it breaks your alibi"],
  ["repeating a push", "a demand with no clue in it"],
  ["making its point and aiming it at you", "showing it to you, or making its point at you"],
  ["they must show you it.", "they must show you what it names."],
];

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("each rule once, no two in conflict", () => {
  it("states every included rule once in the full talk prompt and in Barnaby's", async () => {
    const full = await loadPromptTemplate("talk_conversation", 7, { narrationStyle: "crunchy snow" });
    const { prompt: barnaby } = await talkAt(28, "barnaby", "platform");
    for (const prompt of [full, barnaby]) {
      for (const rule of RULES) expect(count(prompt, rule), rule).toBeLessThanOrEqual(1);
    }
    for (const rule of RULES) expect(count(full, rule), rule).toBe(1);
  });

  it("carries no conflicting pair in any narrator prompt", async () => {
    const prompts = [
      buildTalkConversationTemplate(FULL_TALK_PROFILE),
      (await talkAt(28, "barnaby", "platform")).prompt,
      ...(await Promise.all(
        ["talk_start", "talk_end", "search_bare", "search_targeted", "accusation_start", "accusation_judge"].map(
          (role) => loadPromptTemplate(role as "talk_start", 7, { narrationStyle: "crunchy snow" }),
        ),
      )),
    ];
    for (const prompt of prompts) {
      for (const [old, current] of CONFLICTS) {
        expect(prompt.includes(old) && prompt.includes(current), `${old} / ${current}`).toBe(false);
        expect(prompt).not.toContain(old);
      }
    }
  });

  it("keeps style and reading level in the one shared layer of every role", async () => {
    // Every narrator prompt gets the voice and the reading level once, from
    // the shared layer, and repeats neither in its own rules.
    expect(allRoleRequestNames().length).toBeGreaterThan(0);
    const narration = [
      buildNarrationPrompt({ role: "intro", game_id: "g", blueprint: trace.blueprint }),
      buildNarrationPrompt({ role: "ambience", game_id: "g", blueprint: trace.blueprint, destination_id: "platform", conversation_history: [] }),
    ];
    const templates = await Promise.all(
      ["talk_start", "talk_conversation", "talk_end", "search_bare", "search_targeted", "accusation_start", "accusation_judge"].map(
        (role) => loadPromptTemplate(role as "talk_start", 7),
      ),
    );
    for (const prompt of [...narration, ...templates]) {
      expect(count(prompt, "first-person dialogue")).toBe(1);
      expect(count(prompt, "7 years old")).toBe(1);
      expect(count(prompt, "Choose pronouns")).toBe(1);
      expect(prompt).not.toContain("Never guess pronouns");
      expect(prompt).not.toContain("Do not invent extra");
    }
  });
});
