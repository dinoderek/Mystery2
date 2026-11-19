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

  it("has the accusation roles ask their question in the narration", async () => {
    // The player sees only the narration, so the question belongs there.
    for (const role of ["accusation_start", "accusation_judge"] as const) {
      const template = await loadPromptTemplate(role, 10);
      expect(template).toContain("one short, direct question");
      expect(template).not.toContain("follow_up_prompt");
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

  it("keeps a greeting from firing tells or cracks the investigator has not earned", async () => {
    const talkStart = await loadPromptTemplate("talk_start", 10);

    expect(talkStart).toContain("Nothing is given away in a greeting");
    expect(talkStart).toContain('trigger.kind = "clue": NEVER in a greeting');
    expect(talkStart).toContain("history already shows");
    expect(talkStart).toContain("do not confess");
    // A softened version of an untriggered tell still leaks it.
    expect(talkStart).toContain("off\n  limits even in a milder form");
  });

  it("keeps the investigator where they stand when a talk starts and ends", async () => {
    const vars = { character_name: "Ruby", location_name: "the Tea House" };
    const talkStart = renderPrompt(await loadPromptTemplate("talk_start", 7), vars);
    const talkEnd = renderPrompt(await loadPromptTemplate("talk_end", 7), vars);

    expect(talkStart).toContain("Ruby are both already in\n  the Tea House. Talking moves nobody");
    expect(talkStart).not.toContain("approaches them");
    expect(talkEnd).toContain("Close the active conversation with Ruby in the Tea House.");
    expect(talkEnd).toContain("still in the Tea House");
    expect(talkEnd).toContain("Ending a talk moves nobody:\n  no stepping in, out, back, away or outside");
    expect(talkEnd).not.toContain("returns to exploration");
  });

  it("rewards good roleplay in conversation but gives nothing away for free", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    // Roleplay can stand in for evidence, but only by using it.
    expect(talk).toContain("### Earned, Not Free");
    expect(talk).toContain("Good roleplay can stand in for evidence");
    expect(talk).toContain("It cannot skip a part it never uses");
    expect(talk).toContain("naming you as the culprit");
    // A used part earns its own reaction and nothing more; a confession needs every part.
    expect(talk).toContain("A part is earned once the investigator uses one of its clues");
    expect(talk).toContain('concede what its "shows"\n  says and nothing beyond');
    expect(talk).toContain("Do NOT confess");
    expect(talk).toContain("The confession is null until every part is earned");
    expect(talk).toContain("never a full\nconfession");
    // A clue tell needs that clue, not a general accusation.
    expect(talk).toContain("It must be THAT\n  clue");
    expect(talk).toContain("must never reuse the cue of a tell whose trigger has not\nfired, even in a milder form");
  });

  it("defines using a clue once, and every talk gate refers to it", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);
    const count = (needle: string) => talk.split(needle).length - 1;

    expect(count("### Using a Clue")).toBe(1);
    expect(count("Using a clue means")).toBe(1);
    expect(talk).toContain('"Do you have snowshoes?" does not use the snowshoe prints.');
    expect(talk).toContain('"The luggage-car prints are snowshoes, not paws, so it wasn\'t Gus" does use');
    // Self-protection parts, conditional reveals, earned parts, requires gates and clue tells all point to it.
    expect(talk.match(/\(see\s+Using\s+a\s+Clue/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(talk).toContain("see trigger.clue_ids and Using a Clue");
    // The wordings that disagreed with it are gone.
    expect(talk).not.toContain("not just possess it");
    expect(talk).not.toContain("semantic match against");
    expect(talk).not.toContain("actually holds that clue");
  });

  it("plays from the recorded state, reports use and commitments, and opens the fallback by count", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).toContain("### Your State");
    expect(talk).toContain('Speak from "current_story"');
    expect(talk).toContain("Never take a reaction back");
    expect(talk).toContain('Honour your "commitments"');
    expect(talk).toContain("Never make a new\n  commitment that contradicts your current_story");
    expect(talk).toContain('Report the "gate_clues" ids the investigator used on you this turn in\n  "used_clue_ids"');
    expect(talk).toContain('"used_quote". A clue with "held" false counts only as a bluff');
    expect(talk).toContain('Report each new claim or denial you made this turn in "new_commitments"');
    expect(talk).toContain('When "state.fallback_open" is true');
    expect(talk).not.toContain("3+ times");
  });

  it("presents prerequisites as able to use, never as permission", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).toContain('"player_can_use_prerequisites" true means the player holds those clues');
    expect(talk).toContain("It is a precondition, never permission");
    expect(talk).not.toContain("prereqs_met");
  });

  it("lets an authored reaction move the alibi, and raises the alibi only when asked where or when", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).not.toContain("Your stated alibi still holds");
    expect(talk).not.toContain("admit nothing else from");
    expect(talk).not.toContain("never breaks a\nstated alibi");
    expect(talk).not.toContain("reinforce your stated");
    expect(talk).toContain(
      "Answer the question asked, and raise\nyour stated alibi only when the question is about where you were or when.",
    );
  });

  it("builds a game-start prompt with target age and premise", () => {
    const prompt = buildGameStartPrompt({
      target_age: 8,
      premise: "Someone stole the cake.",
    });

    expect(prompt).toContain("8 years old");
    expect(prompt).toContain("Someone stole the cake.");
  });

  it("builds a revisit-aware move prompt", () => {
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
    // Characters are present, so the arrival plays them as authored without
    // giving anything away.
    expect(prompt).toContain("initial_attitude_towards_investigator");
    expect(prompt).toContain("Arrival reveals no clues");
    expect(prompt).toContain("never state them");
    expect(prompt).toContain('A "clue" tell never surfaces on arrival');
    expect(prompt).toContain("about 52 words"); // ambience@9
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
    // Nobody here: no character rules.
    expect(move).not.toContain("## Characters present");
  });
});
