import { describe, expect, it } from "vitest";
import {
  buildAgeGuidance,
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "../../../supabase/functions/_shared/ai-prompts.ts";

describe("ai-prompts", () => {
  it("injects age-band guidance into all role prompts", async () => {
    const roles = [
      "talk_start",
      "talk_conversation",
      "talk_end",
      "search",
      "search_bare",
      "search_targeted",
      "accusation_start",
      "accusation_judge",
    ] as const;

    for (const role of roles) {
      const template = await loadPromptTemplate(role);
      const rendered = renderPrompt(template, {
        age_guidance: buildAgeGuidance(role, 10),
        character_name: "Alice",
        location_name: "Kitchen",
        player_input: "Where were you?",
        search_query: "under the bed",
        forced_context: "",
        target_age: 10,
      });
      // The rendered prompt carries the concrete age-band guidance, not a bare number.
      expect(rendered).toContain("10 years old");
      expect(rendered.toLowerCase()).toContain("guidance");
      expect(rendered).not.toContain("{{age_guidance}}");
    }
  });

  it("differentiates length guidance by interaction (verdict longer than farewell)", () => {
    const verdict = buildAgeGuidance("accusation_judge", 10);
    const farewell = buildAgeGuidance("talk_end", 10);
    const wordTarget = (s: string) =>
      Number(s.match(/aim for around (\d+) words/)?.[1] ?? 0);
    expect(wordTarget(verdict)).toBeGreaterThan(wordTarget(farewell));
  });

  it("reinforces anti-hallucination guidance in talk prompts", async () => {
    const talkStart = await loadPromptTemplate("talk_start");
    const talkConversation = await loadPromptTemplate("talk_conversation");
    const talkEnd = await loadPromptTemplate("talk_end");

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
        '[{"first_name":"Alice","last_name":"Smith","sex":"female","appearance":"red hair","background":"the baker"}]',
    });

    expect(prompt).toContain("9 years old");
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain("A messy kitchen.");
    expect(prompt).toContain("Characters at destination");
    expect(prompt).toContain('"first_name":"Alice"');
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain("Never guess pronouns");
    expect(prompt).toContain("Do not invent extra characters");
  });
});
