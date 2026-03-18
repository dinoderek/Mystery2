import { describe, expect, it } from "vitest";
import {
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "../../../supabase/functions/_shared/ai-prompts.ts";

describe("ai-prompts", () => {
  it("includes target age guidance in all role prompts", async () => {
    const roles = [
      "talk_start",
      "talk_conversation",
      "talk_end",
      "search",
      "accusation_start",
      "accusation_judge",
    ] as const;

    for (const role of roles) {
      const template = await loadPromptTemplate(role);
      const rendered = renderPrompt(template, {
        character_name: "Alice",
        location_name: "Kitchen",
        player_input: "Where were you?",
        forced_context: "",
        target_age: 10,
      });
      expect(rendered).toContain("10");
    }
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

    expect(prompt).toContain("target age 8");
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

    expect(prompt).toContain("target age 9");
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain("A messy kitchen.");
    expect(prompt).toContain("Characters at destination");
    expect(prompt).toContain('"first_name":"Alice"');
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain("Never guess pronouns");
    expect(prompt).toContain("Do not invent extra characters");
  });
});
