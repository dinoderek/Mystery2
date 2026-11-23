import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { buildTalkConversationContext, type ConversationFragment } from "../../../packages/game-engine/src/ai-context.ts";
import {
  buildCharacterState,
  COMMITMENT_CAP,
  gateClueIds,
  quoteIsPlayerWords,
  safeSteps,
  selectUsedClues,
  type StateCharacter,
  type StateHistoryRow,
} from "../../../packages/game-engine/src/character-state.ts";

const fox: StateCharacter = {
  id: "fox",
  stated_alibi: "I napped on the train.",
  clues: [
    { id: "fox-secret", requires: { kind: "leverage", clue_ids: ["ticket"], rationale: "only once shown the ticket" } },
  ],
  agendas: [
    {
      type: "self_protect",
      parts: [
        { clue_ids: ["prints", "plaster-cast"], reaction: "Stops blaming the wolf, keeps the nap." },
        { clue_ids: ["sighting"], reaction: "Took the long way, then napped." },
      ],
      confession: "Took the case.",
    },
    { type: "conditional_reveal", yields_to_clue_ids: ["map"] },
  ],
};

let sequence = 0;
const talk = (character = "fox"): StateHistoryRow => ({
  sequence: ++sequence,
  event_type: "talk",
  payload: { character_id: character },
});
const ask = (payload: Record<string, unknown> = {}, character = "fox"): StateHistoryRow => ({
  sequence: ++sequence,
  event_type: "ask",
  payload: { character_id: character, ...payload },
});

describe("gate clues", () => {
  it("are what earns a part, opens a reveal, or is a lock's prerequisite", () => {
    expect([...gateClueIds(fox)].sort()).toEqual(["map", "plaster-cast", "prints", "sighting", "ticket"]);
  });
});

describe("selecting the clues a turn used", () => {
  it("drops ids that are not this character's gate clues, and an unheld one with no quote", () => {
    const selection = selectUsedClues(
      { used_clue_ids: ["prints", "fox-secret", "elsewhere", "sighting", "prints"], used_quote: null },
      fox,
      new Set(["prints", "fox-secret", "elsewhere"]),
      "the prints are snowshoes",
    );
    expect(selection.used_clue_ids).toEqual(["prints"]);
    expect(selection.used_quote).toBeNull();
    expect(selection.dropped).toEqual([
      { clue_id: "fox-secret", reason: "not_a_gate_clue" },
      { clue_id: "elsewhere", reason: "not_a_gate_clue" },
      { clue_id: "sighting", reason: "not_held_and_no_quote" },
    ]);
  });

  it("keeps a bluff only when the quote is the player's own words", () => {
    const line = "Bramble SAW you hop to the ticket hut, at ten past three!";
    expect(
      selectUsedClues({ used_clue_ids: ["sighting"], used_quote: "saw you hop to the ticket hut" }, fox, new Set(), line),
    ).toMatchObject({ used_clue_ids: ["sighting"], used_quote: "saw you hop to the ticket hut", dropped: [] });
    expect(
      selectUsedClues({ used_clue_ids: ["sighting"], used_quote: "you were at the hut" }, fox, new Set(), line),
    ).toMatchObject({ used_clue_ids: [], used_quote: null, dropped: [{ clue_id: "sighting", reason: "not_held_and_no_quote" }] });
  });

  it("records a held clue's use, but not a quote that is not the player's words", () => {
    expect(
      selectUsedClues({ used_clue_ids: ["prints"], used_quote: "you wore snowshoes" }, fox, new Set(["prints"]), "The prints are snowshoes, not paws"),
    ).toEqual({ used_clue_ids: ["prints"], used_quote: null, dropped: [] });
  });

  it("matches a quote on whole words, ignoring case and punctuation, and never on one word", () => {
    expect(quoteIsPlayerWords("snowshoes, not paws", "The prints are SNOWSHOES not paws!")).toBe(true);
    expect(quoteIsPlayerWords("prints are", "The prints are snowshoes")).toBe(true);
    expect(quoteIsPlayerWords("snowshoes", "The prints are snowshoes")).toBe(false);
    expect(quoteIsPlayerWords("are snow", "The prints are snowshoes")).toBe(false);
    expect(quoteIsPlayerWords("...", "anything")).toBe(false);
    expect(quoteIsPlayerWords(null, "anything")).toBe(false);
  });
});

describe("a character's state", () => {
  it("starts as the stated alibi, with nothing used or committed", () => {
    expect(buildCharacterState(fox, [])).toEqual({
      used_clue_ids: [],
      earned_parts: [],
      current_story: ["I napped on the train."],
      commitments: [],
      visits_with_questions: 0,
    });
  });

  it("earns a part from any one of its clues, and keeps it across turns and separate visits", () => {
    const history = [
      talk(),
      ask({ used_clue_ids: ["plaster-cast"] }),
      ask({ used_clue_ids: [] }),
      { sequence: ++sequence, event_type: "end_talk", payload: { character_id: "fox" } },
      talk("wolf"),
      ask({ used_clue_ids: ["sighting"] }, "wolf"),
      talk(),
      ask({}),
    ];
    const state = buildCharacterState(fox, history);
    expect(state.used_clue_ids).toEqual(["plaster-cast"]);
    expect(state.current_story).toEqual(["I napped on the train.", "Stops blaming the wolf, keeps the nap."]);
    expect(state.visits_with_questions).toBe(2);
    // Every prefix of the history is a subset of the next: the state only grows.
    for (let n = 1; n < history.length; n += 1) {
      const before = buildCharacterState(fox, history.slice(0, n));
      const after = buildCharacterState(fox, history.slice(0, n + 1));
      expect(after.current_story.slice(0, before.current_story.length)).toEqual(before.current_story);
      expect(after.used_clue_ids.slice(0, before.used_clue_ids.length)).toEqual(before.used_clue_ids);
    }
  });

  it("tells the story in the order the parts were earned, not the order they are authored", () => {
    const state = buildCharacterState(fox, [talk(), ask({ used_clue_ids: ["sighting"] }), ask({ used_clue_ids: ["prints"] })]);
    expect(state.current_story).toEqual([
      "I napped on the train.",
      "Took the long way, then napped.",
      "Stops blaming the wolf, keeps the nap.",
    ]);
    expect(state.earned_parts.map((part) => part.part_index)).toEqual([1, 0]);
  });

  it("tells a reaction two evidence sets share once, and confesses when either set is complete", () => {
    const polish = { clue_ids: ["polish"], reaction: "Says lots of animals came after four." };
    const twoSets: StateCharacter = {
      id: "fox",
      stated_alibi: null,
      clues: [],
      agendas: [
        { type: "self_protect", parts: [polish, { clue_ids: ["paint"], reaction: "Only used the paint on her star." }], confession: "Took it." },
        { type: "self_protect", parts: [polish, { clue_ids: ["dull"], reaction: "Blames Ruby." }], confession: "Took it." },
      ],
    };
    const state = buildCharacterState(twoSets, [talk(), ask({ used_clue_ids: ["polish"] }), ask({ used_clue_ids: ["dull"] })]);
    expect(state.current_story).toEqual(["Says lots of animals came after four.", "Blames Ruby."]);
    expect(state.earned_parts.map((part) => [part.agenda_index, part.part_index])).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it("caps commitments, dropping the oldest first, and keeps a repeated one once at its latest place", () => {
    const said = Array.from({ length: COMMITMENT_CAP + 2 }, (_, i) => `claim ${i + 1}`);
    const state = buildCharacterState(fox, [
      talk(),
      ...said.map((claim) => ask({ new_commitments: [claim] })),
      ask({ new_commitments: ["CLAIM 4"] }),
    ]);
    expect(state.commitments).toHaveLength(COMMITMENT_CAP);
    expect(state.commitments).toEqual(["claim 3", "claim 5", "claim 6", "claim 7", "CLAIM 4"]);
  });

  it("counts the visit of a question still being asked", () => {
    const history = [talk(), ask(), talk(), ask(), talk()];
    expect(buildCharacterState(fox, history).visits_with_questions).toBe(2);
    expect(buildCharacterState(fox, history, { asking_now: true }).visits_with_questions).toBe(3);
  });
});

describe("the steps a character may speak of", () => {
  const steps = [1, 2, 3, 4].map((sequence) => ({ sequence, summary: `step ${sequence}` }));
  const hiding: StateCharacter = {
    ...fox,
    agendas: [
      {
        type: "self_protect",
        parts: [
          { clue_ids: ["prints"], reaction: "Stops blaming the wolf, keeps the nap." },
          { clue_ids: ["sighting"], reaction: "Took the long way, then napped.", concedes_steps: [2] },
        ],
        confession: "Took the case.",
        hides_steps: [2, 3],
      },
      { type: "self_protect", parts: [{ clue_ids: ["map"], reaction: "Wants the map." }], confession: "Wants it badly.", hides_steps: [4] },
    ],
  };
  const sequences = (history: StateHistoryRow[]) =>
    safeSteps(hiding, buildCharacterState(hiding, history), steps).map((step) => step.sequence);

  it("withholds every step a cover hides until it is given up", () => {
    expect(sequences([talk()])).toEqual([1]);
  });

  it("gives up a step once the part that concedes it is earned, and no other", () => {
    expect(sequences([talk(), ask({ used_clue_ids: ["sighting"] })])).toEqual([1, 2]);
    expect(sequences([talk(), ask({ used_clue_ids: ["prints"] })])).toEqual([1]);
  });

  it("gives up all an agenda hides once its confession is earned", () => {
    expect(sequences([talk(), ask({ used_clue_ids: ["prints", "sighting"] })])).toEqual([1, 2, 3]);
    expect(sequences([talk(), ask({ used_clue_ids: ["map"] })])).toEqual([1, 4]);
  });

  it("hides nothing for a character whose agendas name no steps", () => {
    expect(safeSteps(fox, buildCharacterState(fox, []), steps)).toEqual(steps);
  });
});

describe("Barnaby's talk context, rebuilt from the stored snow-foxes game", () => {
  const trace = JSON.parse(
    fs.readFileSync("tests/api/unit/fixtures/snow-foxes-trace.json", "utf8"),
  ) as { blueprint: Parameters<typeof buildTalkConversationContext>[0]["blueprint"]; events: ConversationFragment[] };
  // The stored game predates recorded use, so turn 28's line, which makes the
  // prints' point at Barnaby, carries what the engine now records for it.
  const recorded = trace.events.map((event) =>
    event.sequence === 28
      ? { ...event, payload: { ...event.payload, used_clue_ids: ["clue_snowshoe_prints"], used_quote: "the prints were snowshoes not wolf paws" } }
      : event
  );
  const contextAt = (sequence: number) => {
    const event = recorded.find((entry) => entry.sequence === sequence)!;
    return buildTalkConversationContext({
      game_id: "stored",
      session: { mode: "talk", current_location_id: "platform", current_talk_character_id: "barnaby", time_remaining: 5 },
      blueprint: trace.blueprint,
      character_id: "barnaby",
      location_id: "platform",
      player_input: String(event.payload?.player_input ?? ""),
      conversation_history: recorded.filter((entry) => entry.sequence < sequence),
    }).talk_context!.active_character;
  };

  it("holds only the nap at turn 28, before the prints are used", () => {
    const barnaby = contextAt(28);
    expect(barnaby.state.current_story).toEqual([
      "I napped in my seat on the train from ten past three until I heard Howard shout.",
    ]);
    expect(barnaby.gate_clues).toContainEqual({ id: "clue_snowshoe_prints", held: true });
    expect(JSON.stringify(barnaby)).not.toContain("Backs off blaming Gus");
    // He may speak of the cocoa and the shout; how he took the case stays back.
    expect(barnaby.actual_actions.map((step) => step.sequence)).toEqual([1, 2, 9]);
    expect(JSON.stringify(barnaby)).not.toContain("snowshoes from the hooks");
    expect(JSON.stringify(barnaby)).not.toContain("hides_steps");
  });

  it("with the prints used, his only earned reaction is backing off blaming Gus, and he keeps the nap", () => {
    const barnaby = contextAt(29);
    expect(barnaby.state).toMatchObject({
      used_clue_ids: ["clue_snowshoe_prints"],
      current_story: [
        "I napped in my seat on the train from ten past three until I heard Howard shout.",
        "Backs off blaming Gus, flustered, but keeps the nap.",
      ],
      commitments: [],
      fallback_open: false,
    });
    const alibi = barnaby.agendas[0];
    expect(alibi.parts?.map((part) => part.earned)).toEqual([true, false, false]);
    expect(alibi.confession).toBeNull();
    const serialized = JSON.stringify(barnaby);
    expect(serialized).not.toContain("took the long way");
    expect(serialized).not.toContain("lots of animals have white fur");
    expect(serialized).not.toContain("Teary-eyed");
  });
});
