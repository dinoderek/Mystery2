import { describe, expect, it } from "vitest";
import {
  buildAgeGuidance,
  buildGameMovePrompt,
  buildGameStartPrompt,
  buildStyleGuidance,
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

  it("keeps the two search prompts' own rules within 2,256 characters", async () => {
    // The roles' own rules, without the shared age and style guidance they load.
    const ownLength = async (role: "search_bare" | "search_targeted") =>
      (await loadPromptTemplate(role, 10)).length - buildAgeGuidance(role, 10).length - buildStyleGuidance().length;
    const total = (await ownLength("search_bare")) + (await ownLength("search_targeted"));
    // A rule added here pays for itself with a trim elsewhere.
    expect(total).toBeLessThanOrEqual(2256);
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
    expect(styled).toContain("where it and the reading level pull apart, the reading level wins");
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

  it("carries the anti-hallucination rule in the shared layer of every talk prompt", async () => {
    for (const role of ["talk_start", "talk_conversation", "talk_end"] as const) {
      const prompt = await loadPromptTemplate(role, 10);
      expect(prompt).toContain("Use only the characters, places and facts you are given; never invent more.");
      expect(prompt).toContain("Choose pronouns from each character's sex, never by guessing.");
    }
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

  it("leaves one judgement to the narrator, whether a clue was used, and gives nothing away for free", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).toContain("Your one judgement: did the investigator use a clue this turn?");
    expect(talk).toContain("Naming you as the culprit, insisting, repeating a push, asking to look somewhere");
    expect(talk).toContain("kindness (unless a condition asks for trust), or a case built on other clues uses nothing");
    // Every character shares an earned clue no agenda holds back.
    expect(talk).toContain("Share a clue when it answers the question, once any lock on it is earned and no agenda holds it back.");
    // A used part earns its own concession and nothing more; a confession needs every part.
    expect(talk).toContain('When an unearned part\'s clue is used, concede what its "shows" says');
    expect(talk).toContain("and nothing beyond");
    expect(talk).toContain('An agenda\'s "confession" is null until all its parts are earned; once it is given, you may confess it.');
    expect(talk).toContain("never a confession");
    // A clue tell needs that clue, not a general accusation, and never leaks softened.
    expect(talk).toContain('- "clue": only when that clue is used. A general accusation does not count.');
    expect(talk).toContain("Never show an untriggered tell's cue, even softened");
    // The referee rules the engine's state replaced are gone.
    expect(talk).not.toContain("### Earned, Not Free");
    expect(talk).not.toContain("Some parts earned");
    expect(talk).not.toContain("A part with no clue is earned");
  });

  it("defines using a clue once, with the snowshoe examples", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);
    const count = (needle: string) => talk.split(needle).length - 1;

    expect(count("## Using a clue")).toBe(1);
    expect(count("Using a clue means")).toBe(1);
    expect(talk).toContain('"Do you have snowshoes?" does not use the snowshoe prints.');
    expect(talk).toContain('"The luggage-car prints are snowshoes, not paws, so it wasn\'t Gus" does.');
    // Gates say "used", and lean on the one definition rather than restating it.
    expect(talk).toContain("its yields_to_clue_ids are used, this turn or in state.used_clue_ids");
    expect(talk).toContain("until the investigator uses what it names");
    expect(talk).not.toContain("see Using a Clue");
    expect(talk).not.toContain("not just possess it");
    expect(talk).not.toContain("semantic match against");
    expect(talk).not.toContain("actually holds that clue");
  });

  it("plays from the recorded state, reports use and commitments, and opens the fallback by count", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).toContain("## Your state");
    expect(talk).toContain('Speak from "current_story"');
    expect(talk).toContain("and any older commitment it contradicts");
    expect(talk).toContain("Never take a reaction back");
    expect(talk).toContain('Keep your "commitments", and never make one that contradicts current_story');
    expect(talk).toContain('Put the "gate_clues" ids used this turn in "used_clue_ids"');
    expect(talk).toContain('"used_quote". A clue with "held" false counts only as a bluff');
    expect(talk).toContain('List each new claim or denial in "new_commitments"');
    expect(talk).toContain('"state.fallback_open" is true');
    expect(talk).not.toContain("3+ times");
  });

  it("presents prerequisites as able to use, never as permission", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).toContain('"player_can_use_prerequisites" true means they hold it: a precondition, never permission.');
    expect(talk).not.toContain("prereqs_met");
  });

  it("lets an authored reaction move the alibi, and raises the alibi only when asked where or when", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);

    expect(talk).not.toContain("Your stated alibi still holds");
    expect(talk).not.toContain("admit nothing else from");
    expect(talk).not.toContain("reinforce your stated");
    expect(talk).toContain("Raise your alibi only when asked where you were or when.");
  });

  it("keeps the speaker to the steps it may speak of", async () => {
    const talk = await loadPromptTemplate("talk_conversation", 10);
    expect(talk).toContain("Keep to actual_actions, the parts of your day you will speak of.");
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
      last_arrival_narration: "You step into the messy kitchen.",
      destination_characters_json:
        '[{"first_name":"Alice","last_name":"Smith","sex":"female","appearance":"red hair","manner":[],"tells":[]}]',
    });

    expect(prompt).toContain("9 years old");
    expect(prompt).toContain("acknowledge the return visit");
    expect(prompt).toContain("A messy kitchen.");
    expect(prompt).toContain("Characters at destination");
    expect(prompt).toContain('"first_name":"Alice"');
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain("never by guessing");
    expect(prompt).toContain("never invent more");
    expect(prompt).toContain("Narration style");
    // Characters are present, so the arrival plays them as authored. The rules
    // name only fields the pack carries: no private field is listed to forbid it.
    expect(prompt).toContain("initial_attitude_towards_investigator");
    expect(prompt).toContain("manner");
    expect(prompt).toContain("has not asked them anything yet");
    const rules = prompt.slice(prompt.indexOf("## Characters present")).split("\nDestination description:")[0];
    for (const field of ["motive", "actual_actions", "stated_alibi", "flavor_knowledge", "background", "clue"]) {
      expect(rules).not.toContain(field);
    }
    expect(prompt).toContain('Last arrival here: "You step into the messy kitchen."');
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
      destination_characters_json: "[]",
    });
    expect(move).toContain("Narration style");
    expect(move).not.toContain("This mystery's own voice");
    // Nobody here: no character rules.
    expect(move).not.toContain("## Characters present");
  });
});
