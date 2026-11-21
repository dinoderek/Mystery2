// The clue-graph narrator case library (`evaluation/runtime/cases/clue-graph/`)
// and the talk prompt it measures: every case loads, plays a history the engine
// could have recorded, and expects only what its state offers; and the talk
// prompt is one prompt for every character and state, with no section per
// mechanism. No model is called.

import { describe, expect, it } from "vitest";
import type { AIContext } from "../../../packages/game-engine/src/ai-context.ts";
import { linesThisConversation } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { GRAPH_TALK_PROMPT } from "../../../packages/game-engine/src/clue-graph/prompts.ts";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { loadCasesFrom, readBlueprint, type TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { validateExpect } from "../../../evaluation/runtime/lib/expect.ts";
import { getAction, normalizeHistory } from "../../../evaluation/runtime/lib/roles.ts";
import { played, readGraph } from "../../../evaluation/runtime/cases/clue-graph/support/play.ts";

const LIBRARY = "evaluation/runtime/cases/clue-graph/greenhouse";
const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";

interface Built {
  turnCase: TurnCase;
  prompt: string;
  context: AIContext;
}

async function buildAll(): Promise<Built[]> {
  const cases = await loadCasesFrom(LIBRARY);
  const { blueprint } = await readBlueprint(GREENHOUSE, process.cwd());
  return Promise.all(
    cases.map(async (turnCase) => {
      const input = getAction(turnCase.action.type).roleInput(turnCase.given, turnCase.action, blueprint as never, normalizeHistory(turnCase.given.history));
      const request = await buildRoleRequest(input as never);
      return { turnCase, prompt: request.prompt, context: request.context };
    }),
  );
}

/** What a talk line's state offers to open or answer. */
function offered(context: AIContext): Set<string> {
  const { state } = context.graph_talk_context!;
  return new Set([...state.gates, ...state.answers_if_asked, ...state.shows_when].map((entry) => entry.id));
}

/** What a search's outcome can find. */
function findable(context: AIContext): Set<string> {
  const { outcome } = context.graph_search_context!;
  if (outcome.kind === "known") return new Set(outcome.finds ? [outcome.finds.id] : []);
  return new Set(outcome.candidates.map((candidate) => candidate.clue.id));
}

describe("the clue-graph greenhouse case library", async () => {
  const built = await buildAll();
  const graph = readGraph(GREENHOUSE);

  it("loads, with unique IDs, a graded expect and a group on every case", () => {
    expect(built.length).toBeGreaterThan(30);
    expect(new Set(built.map(({ turnCase }) => turnCase.id)).size).toBe(built.length);
    for (const { turnCase } of built) {
      expect(() => validateExpect(turnCase), turnCase.id).not.toThrow();
      expect(turnCase.blueprint.path, turnCase.id).toBe(GREENHOUSE);
      expect(turnCase.group, turnCase.id).toMatch(/^(shown|shown-after-dodge|bluffed|worded-line|asked|confession|hold-[a-z-]+|search-[a-z]+)$/);
    }
  });

  it("covers every kind the narrator is measured on", () => {
    const groups = new Set(built.map(({ turnCase }) => turnCase.group));
    for (const kind of ["shown", "asked", "worded-line", "bluffed", "shown-after-dodge", "hold-pushed", "hold-small-talk", "search-spot", "search-plain", "search-nothing"])
      expect(groups, kind).toContain(kind);
  });

  it("expects of each talk line only gates and answers its state offers, and a hold case has something to hold", () => {
    for (const { turnCase, context } of built.filter(({ turnCase }) => turnCase.action.type === "ask")) {
      const expected = turnCase.expect!.revealed_clue_ids!;
      const offers = offered(context);
      for (const id of expected) {
        expect(graph.clues[id], `${turnCase.id}: ${id}`).toBeDefined();
        expect(offers.has(id), `${turnCase.id}: ${id} is not on offer`).toBe(true);
      }
      if (turnCase.group!.startsWith("hold-")) {
        expect(expected, turnCase.id).toEqual([]);
        expect(offers.size, `${turnCase.id} offers nothing to hold back`).toBeGreaterThan(0);
      } else {
        expect(expected.length, turnCase.id).toBeGreaterThan(0);
      }
    }
  });

  it("bluffs only gates it may, with nothing held to show, and a held-not-used case holds what it does not use", () => {
    const talk = built.filter(({ turnCase }) => turnCase.action.type === "ask");
    const gatesOf = ({ context }: Built) => context.graph_talk_context!.state.gates;
    for (const one of talk.filter(({ turnCase }) => turnCase.group === "bluffed")) {
      const opened = gatesOf(one).filter((gate) => one.turnCase.expect!.revealed_clue_ids!.includes(gate.id));
      expect(opened.length, one.turnCase.id).toBeGreaterThan(0);
      for (const gate of opened) {
        expect(gate.bluffable, `${one.turnCase.id}: ${gate.id}`).toBe(true);
        expect(gate.opens_with.show?.clues.some((clue) => clue.held), `${one.turnCase.id}: ${gate.id} is shown, not bluffed`).toBe(false);
      }
    }
    for (const one of talk.filter(({ turnCase }) => turnCase.group === "hold-held-not-used")) {
      const held = gatesOf(one).flatMap((gate) => gate.opens_with.show?.clues ?? []).filter((clue) => clue.held);
      expect(held.length, `${one.turnCase.id} holds nothing it could use`).toBeGreaterThan(0);
    }
  });

  it("expects of each search a clue its outcome can find, or none", () => {
    for (const { turnCase, context } of built.filter(({ turnCase }) => turnCase.action.type === "search")) {
      const id = turnCase.expect!.revealed_clue_id;
      expect(id === undefined, turnCase.id).toBe(false);
      if (id === null) continue;
      expect(graph.clues[id!]?.kind, turnCase.id).toBe("evidence");
      expect(findable(context).has(id!), `${turnCase.id}: ${id} cannot be found here`).toBe(true);
    }
  });

  it("plays histories the engine would record, and refuses one whose report it would drop", () => {
    for (const { turnCase } of built) {
      const recorded = (turnCase.given.history ?? []).every((row) => row.payload?.clue_graph !== undefined);
      expect(recorded, turnCase.id).toBe(true);
    }
    expect(() =>
      played(graph, [{ move: "thorne_garden" }, { talk: "thorne", narration: "Hello." }, { say: "Hi.", reply: "Hm.", opened: ["toby_confession"] }]),
    ).toThrow(/toby_confession/);
    expect(() => played(graph, [{ say: "Hi.", reply: "Hm." }])).toThrow(/outside a conversation/);
  });
});

describe("the clue-graph talk prompt", async () => {
  const built = (await buildAll()).filter(({ turnCase }) => turnCase.action.type === "ask");

  /** The prompt with what each case fills in taken out. */
  function template({ prompt, context, turnCase }: Built): string {
    const talk = context.graph_talk_context!;
    return prompt
      .replace(/\nEarlier in this conversation, they said:\n(- ".*"\n)+A clue used .*/, "")
      .split(`"${turnCase.action.player_input}"`).join('"<line>"')
      .split(talk.location_name).join("<location>")
      .split(talk.character.name).join("<character>");
  }

  it("is written from the objective, in two sections", () => {
    expect(GRAPH_TALK_PROMPT.match(/^## .+$/gm)).toEqual(["## What you are given", "## What this line earns"]);
    expect(GRAPH_TALK_PROMPT).toContain("The game rewards real detective work at once. Be generous about how the investigator puts things");
    expect(GRAPH_TALK_PROMPT).toContain("and strict about what they actually do.");
  });

  it("is the same prompt for every character and state, with no section added per mechanism", () => {
    const templates = new Set(built.map(template));
    expect(templates.size).toBe(1);
    const [only] = templates;
    expect(only.match(/^## .+$/gm)).toEqual(["## Narration style", "## What you are given", "## What this line earns"]);
    expect(only).not.toMatch(/agenda|self.protect|commitment|fallback|## (Locked|Reactions|Held-back)/i);
  });

  it("restates the investigator's earlier lines in this conversation beside the line, and only those", () => {
    const followUp = built.find(({ turnCase }) => turnCase.id === "toby-glass-follow-up")!;
    expect(followUp.prompt).toContain('Earlier in this conversation, they said:\n- "Why do you think it was Mr. Thorne?"\n- "toby the glass from the window was OUTSIDE on the path not inside"\nA clue used in one of those lines still counts now. If its gate is still in gates, Toby dodged it once already');
    const first = built.find(({ turnCase }) => turnCase.id === "thorne-boots-by-implication")!;
    expect(first.prompt).not.toContain("Earlier in this conversation");

    const line = (character: string, said: string) => ({ payload: { player_input: said, clue_graph: { type: "line", character } } });
    const talk = (character: string) => ({ payload: { clue_graph: { type: "talk", character } } });
    const history = [talk("toby"), line("toby", "first visit"), talk("mia"), line("mia", "to Mia"), talk("toby"), line("toby", "again"), { payload: { player_input: "gibberish" } }, line("toby", "then")];
    expect(linesThisConversation(history, "toby")).toEqual(["again", "then"]);
    expect(linesThisConversation(history, "mia")).toEqual(["to Mia"]);
    expect(linesThisConversation([], "toby")).toEqual([]);
  });
});
