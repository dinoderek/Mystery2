import { describe, expect, it } from "vitest";
import type { AIPromptKey } from "../../../packages/game-engine/src/ai-contracts.ts";
import {
  buildAgeGuidance,
  buildGameMovePrompt,
  buildGameStartPrompt,
  buildStyleGuidance,
  loadPromptTemplate,
  renderPrompt,
} from "../../../packages/game-engine/src/ai-prompts.ts";

/** The roles that narrate. `graph_accusation` only reads the accusation, so its prompt carries neither. */
const ROLES: readonly AIPromptKey[] = [
  "talk_end",
  "accusation_start",
  "graph_talk",
  "graph_search",
  "graph_accusation_round",
  "graph_ending",
];

const wordTarget = (s: string) => Number(s.match(/aim for about (\d+) words/)?.[1] ?? 0);

describe("ai-prompts", () => {
  it("loadPromptTemplate injects age-band and style guidance for every role (cannot be forgotten)", async () => {
    for (const role of ROLES) {
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
        forced_context: "",
      });
      expect(rendered).toContain("10 years old");
    }
  });

  it("puts the original limits on invented details in each narration prompt", async () => {
    for (const role of ROLES) {
      const template = await loadPromptTemplate(role, 10);
      expect(template).toContain("Choose pronouns from each character's sex, never by guessing.");
      expect(template).toContain("Nothing you add looks like evidence or bears on who, when or where");
      expect(template).toContain("What earlier narration established stays");
    }
  });

  it("tells the accusation round and ending that only the narrator speaks, and every other role keeps the dialogue rule", async () => {
    const dialogue = "Characters always speak in direct first-person dialogue";
    const narratorOnly = "No one speaks in this scene but you, the narrator";
    for (const role of ["graph_accusation_round", "graph_ending"] as const) {
      const template = await loadPromptTemplate(role, 7);
      expect(template).toContain(narratorOnly);
      expect(template).not.toContain(dialogue);
      expect(template).toContain("## What you may make up");
    }
    // Only the ending retells the account, where a character's words may be quoted.
    expect(await loadPromptTemplate("graph_ending", 7)).toContain("What a character said in the account");
    expect(await loadPromptTemplate("graph_accusation_round", 7)).not.toContain("What a character said");
    for (const role of ["graph_talk", "graph_search", "accusation_start", "talk_end"] as const) {
      const template = await loadPromptTemplate(role, 7);
      expect(template).toContain(dialogue);
      expect(template).not.toContain(narratorOnly);
    }
  });

  it("builds the style guidance with a role's own voice in place of the dialogue line", () => {
    const standard = buildStyleGuidance();
    expect(standard).toContain("Characters always speak in direct first-person dialogue");
    const voiced = buildStyleGuidance("- Only the narrator speaks.");
    expect(voiced).toContain("- Only the narrator speaks.");
    expect(voiced).not.toContain("Characters always speak in direct first-person dialogue");
    expect(voiced).toContain("## What you may make up");
  });

  it("states both search budgets when the outcome is the model's to judge", async () => {
    const judged = await loadPromptTemplate("graph_search", 10);

    // The model decides the outcome, so both budgets must be in the prompt.
    expect(judged).toContain("if you reveal a clue, aim for about 35 words");
    expect(judged).toContain("if you reveal nothing, aim for about 20 words");

    // A known outcome picks one budget.
    const found = await loadPromptTemplate("graph_search", 10, { interaction: "search_find" });
    expect(found).toContain("aim for about 35 words");
    expect(found).not.toContain("if you reveal nothing");
    const empty = await loadPromptTemplate("graph_search", 10, { interaction: "search_empty" });
    expect(wordTarget(found)).toBeGreaterThan(wordTarget(empty));
  });

  it("has the accusation scene ask its question in the narration", async () => {
    // The player sees only the narration, so the question belongs there.
    const template = await loadPromptTemplate("accusation_start", 10);
    expect(template).toContain("one short, direct question");
    expect(template).not.toContain("follow_up_prompt");
  });

  it("differentiates length guidance by interaction (verdict longer than farewell)", () => {
    const verdict = buildAgeGuidance("graph_ending", 10);
    const farewell = buildAgeGuidance("talk_end", 10);
    expect(wordTarget(verdict)).toBeGreaterThan(wordTarget(farewell));
  });

  it("keeps the investigator where they stand when a talk ends", async () => {
    const vars = { character_name: "Ruby", location_name: "the Tea House" };
    const talkEnd = renderPrompt(await loadPromptTemplate("talk_end", 7), vars);

    expect(talkEnd).toContain("Close the active conversation with Ruby in the Tea House.");
    expect(talkEnd).toContain("still in the Tea House");
    expect(talkEnd).toContain("Ending a talk moves nobody:\n  no stepping in, out, back, away or outside");
    expect(talkEnd).not.toContain("returns to exploration");
  });

  it("builds a game-start prompt with target age and every opening fact", () => {
    const prompt = buildGameStartPrompt({
      target_age: 8,
      facts: ["Someone stole the cake.", "The baker was out at noon."],
    });

    expect(prompt).toContain("8 years old");
    expect(prompt).toContain("Narration style");
    expect(prompt).toContain("Tell every fact below in your own words; leave none out.");
    expect(prompt).toContain("Opening facts:\n- Someone stole the cake.\n- The baker was out at noon.");
  });

  it("builds a revisit-aware move prompt", () => {
    const prompt = buildGameMovePrompt({
      target_age: 9,
      destination_name: "Kitchen",
      destination_facts: ["A messy kitchen."],
      has_visited_before: true,
      last_arrival_narration: "You step into the messy kitchen.",
      destination_characters_json: '[{"first_name":"Alice","sex":"female","appearance":"red hair"}]',
    });

    expect(prompt).toContain("9 years old");
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain("Describe the player arriving at Kitchen.");
    expect(prompt).toContain("Facts about the place:\n- A messy kitchen.");
    expect(prompt).toContain("Characters at destination");
    expect(prompt).toContain('"first_name":"Alice"');
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain("Narration style");
    // Characters are present, so the arrival plays them as authored. The rules
    // name only fields the pack carries: no private field is listed to forbid it.
    expect(prompt).toContain("initial_attitude_towards_investigator");
    expect(prompt).toContain("has not asked them anything yet");
    const rules = prompt.slice(prompt.indexOf("## Characters present")).split("\nFacts about the place:")[0];
    for (const field of ["motive", "actual_actions", "stated_alibi", "flavor_knowledge", "background", "clue", "manner", "tells"]) {
      expect(rules).not.toContain(field);
    }
    expect(prompt).toContain('Last arrival here: "You step into the messy kitchen."');
    expect(prompt).toContain("about 52 words"); // ambience@9
  });

  it("leaves the character rules out of an arrival with nobody there", () => {
    const move = buildGameMovePrompt({
      target_age: 9,
      destination_name: "Kitchen",
      destination_facts: ["A messy kitchen."],
      has_visited_before: false,
      destination_characters_json: "[]",
    });
    expect(move).toContain("Narration style");
    expect(move).toContain("arriving here for the first time");
    expect(move).not.toContain("## Characters present");
    expect(move).not.toContain("Last arrival here");
  });

  it("lists the searchable areas an arrival may advertise", () => {
    const move = buildGameMovePrompt({
      target_age: 9,
      destination_name: "Kitchen",
      destination_facts: ["A messy kitchen."],
      has_visited_before: false,
      destination_characters_json: "[]",
      destination_sub_locations_json: '[{"name":"the pantry shelf"}]',
    });
    expect(move).toContain('Searchable areas at this location: [{"name":"the pantry shelf"}]');
  });
});
