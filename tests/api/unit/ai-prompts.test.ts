import { describe, expect, it } from "vitest";
import {
  buildAgeGuidance,
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "../../../packages/game-engine/src/ai-prompts.ts";

describe("ai-prompts", () => {
  it("loadPromptTemplate injects age-band and style guidance for every role (cannot be forgotten)", async () => {
    const roles = [
      "talk_start",
      "talk_conversation",
      "talk_end",
      "search_bare",
      "search_targeted",
      "accusation_start",
      "accusation_judge",
    ] as const;

    for (const role of roles) {
      // The loader fills {{age_guidance}} and {{style_guidance}} itself —
      // callers never pass them.
      const template = await loadPromptTemplate(role, 10);
      expect(template).toContain("10 years old");
      expect(template.toLowerCase()).toContain("guidance");
      expect(template).toContain("Narration style");
      expect(template).not.toContain("{{age_guidance}}");
      expect(template).not.toContain("{{style_guidance}}");

      // Rendering the remaining variables must not reintroduce a blank slot.
      const rendered = renderPrompt(template, {
        character_name: "Alice",
        location_name: "Kitchen",
        player_input: "Where were you?",
        search_query: "under the bed",
        forced_context: "",
      });
      expect(rendered).toContain("10 years old");
    }
  });

  it("layers the blueprint's narration_style on top of the standard style", async () => {
    const plain = await loadPromptTemplate("talk_start", 10);
    expect(plain).toContain("Narration style");
    expect(plain).not.toContain("This mystery's own voice");

    const styled = await loadPromptTemplate("talk_start", 10, {
      narrationStyle: "salty harbor air and gull cries",
    });
    expect(styled).toContain("Narration style");
    expect(styled).toContain(
      "This mystery's own voice (follow it within the rules above): salty harbor air and gull cries",
    );
  });

  it("bare search can borrow the clue-reveal word budget when a clue will surface", async () => {
    const wordTarget = (s: string) =>
      Number(s.match(/aim for about (\d+) words/)?.[1] ?? 0);

    const empty = await loadPromptTemplate("search_bare", 10);
    const reveal = await loadPromptTemplate("search_bare", 10, {
      interaction: "search_find",
    });
    expect(wordTarget(reveal)).toBeGreaterThan(wordTarget(empty));
  });

  it("targeted search states both budgets rather than always billing the clue-reveal one", async () => {
    const targeted = await loadPromptTemplate("search_targeted", 10);

    // The model decides the outcome, so both budgets must be in the prompt.
    expect(targeted).toContain("if you reveal a clue, aim for about 35 words");
    expect(targeted).toContain("if you reveal nothing, aim for about 20 words");

    // An empty targeted search must not cost more words than an empty bare one.
    const bareEmpty = await loadPromptTemplate("search_bare", 10);
    expect(bareEmpty).toContain("aim for about 20 words");

    // An explicit interaction override still wins over the branched budget.
    const forced = await loadPromptTemplate("search_targeted", 10, {
      interaction: "search_find",
    });
    expect(forced).toContain("aim for about 35 words");
    expect(forced).not.toContain("if you reveal nothing");
  });

  it("subordinates the blueprint's voice to the reading level", async () => {
    const styled = await loadPromptTemplate("talk_start", 10, {
      narrationStyle: "wry, gothic, faintly archaic",
    });
    expect(styled).toContain("where the two pull apart, the reading level wins");
  });

  it("tells the accusation roles that follow_up_prompt is player-facing too", async () => {
    for (const role of ["accusation_start", "accusation_judge"] as const) {
      const template = await loadPromptTemplate(role, 10);
      expect(template).toContain('"follow_up_prompt" is shown to the player as well');
    }
  });

  it("differentiates length guidance by interaction (verdict longer than farewell)", () => {
    const verdict = buildAgeGuidance("accusation_judge", 10);
    const farewell = buildAgeGuidance("talk_end", 10);
    const wordTarget = (s: string) =>
      Number(s.match(/aim for about (\d+) words/)?.[1] ?? 0);
    expect(wordTarget(verdict)).toBeGreaterThan(wordTarget(farewell));
  });

  it("reinforces anti-hallucination guidance in talk prompts", async () => {
    const talkStart = await loadPromptTemplate("talk_start", 10);
    const talkConversation = await loadPromptTemplate("talk_conversation", 10);
    const talkEnd = await loadPromptTemplate("talk_end", 10);

    expect(talkStart).toContain("Do not invent extra people, places, or world facts.");
    expect(talkConversation).toContain("Do not invent extra people, places, or world facts.");
    expect(talkEnd).toContain("Do not invent extra people, places, or world facts.");
  });

  it("builds a game-start prompt with target age and premise", () => {
    const prompt = buildGameStartPrompt({
      target_age: 8,
      premise: "Someone stole the cake.",
    });

    expect(prompt).toContain("8 years old");
    expect(prompt).toContain("Someone stole the cake.");
  });

  it("builds a revisit-aware game-move prompt", () => {
    const prompt = buildGameMovePrompt({
      target_age: 9,
      destination_name: "Kitchen",
      destination_description: "A messy kitchen.",
      has_visited_before: true,
      destination_history_json: "[]",
      destination_characters_json:
        '[{"first_name":"Alice","last_name":"Smith","sex":"female","appearance":"red hair","public_summary":"The baker; was in the kitchen."}]',
    });

    expect(prompt).toContain("9 years old");
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain("A messy kitchen.");
    expect(prompt).toContain("Characters at destination");
    expect(prompt).toContain('"first_name":"Alice"');
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain("Never guess pronouns");
    expect(prompt).toContain("Do not invent extra characters");
    expect(prompt).toContain("Narration style");
  });

  it("includes the standard style (and optional blueprint voice) in start/move prompts", () => {
    const start = buildGameStartPrompt({
      target_age: 8,
      premise: "Someone stole the cake.",
      narration_style: "seaside carnival bustle",
    });
    expect(start).toContain("Narration style");
    expect(start).toContain("This mystery's own voice (follow it within the rules above): seaside carnival bustle");

    const move = buildGameMovePrompt({
      target_age: 9,
      destination_name: "Kitchen",
      destination_description: "A messy kitchen.",
      has_visited_before: false,
      destination_history_json: "[]",
      destination_characters_json: "[]",
    });
    expect(move).toContain("Narration style");
    expect(move).not.toContain("This mystery's own voice");
  });
});
