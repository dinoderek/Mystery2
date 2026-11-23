// The accusation on a clue-graph case: the engine's rule over the graph and
// the clues held, and what the narrator is given to word it, before the case
// is resolved and once it is.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClueGraphBlueprint, validateClueGraph, type ClueGraphCase } from "@my2/shared";
import {
  confessionClues,
  accusationReply,
  culpritOf,
  decideAccusation,
  questionLead,
  supportingClues,
  verdictContext,
  type AccusationVerdict,
} from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { startPlay, type ClueGraphEvent, type ClueGraphPlay } from "../../../packages/game-engine/src/clue-graph/play.ts";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { notebook } from "../../../packages/game-engine/src/clue-graph/leads.ts";
import { createAIProviderFromProfile } from "../../../packages/game-engine/src/ai-provider.ts";
import { parseGraphAccusationRoundOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import { loadPromptTemplate } from "../../../packages/game-engine/src/ai-prompts.ts";
import { assertRoleContextSafety } from "../../../packages/game-engine/src/ai-context.ts";

function greenhouse(): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));
}

const graph = greenhouse();

/** A play holding `held`, with `retracted` taken back. */
function holding(held: string[], retracted: string[] = []): ClueGraphPlay {
  return { ...startPlay(graph), held, retracted };
}

/** Earlier failed accusations, each saved with its decision. */
function failures(count: number) {
  return Array.from({ length: count }, () => ({
    event_type: "accuse_failed",
    payload: { judge_result: "continue", clue_graph_accusation: { accused: null, cited: [], verdict: "not_yet" } },
  }));
}

const WELLY_ROUTE = ["clue_welly_prints", "clue_dobbs_crash_time", "clue_thorne_mia_cake"];

describe("the clue-graph accusation rule", () => {
  it("wins on the right name with a held supporting clue cited", () => {
    const play = holding(WELLY_ROUTE);
    expect(supportingClues(graph, play)).toEqual(WELLY_ROUTE);
    expect(decideAccusation(graph, play, [], { accused: "toby", cited: ["clue_welly_prints"] })).toBe("win");
  });

  it("wins on the right name with the confession held, cited or not", () => {
    expect(confessionClues(graph)).toEqual(["toby_confession"]);
    expect(decideAccusation(graph, holding(["toby_confession"]), [], { accused: "toby", cited: [] })).toBe("win");
  });

  it("fails a right name with support held but not cited, as any other failure", () => {
    expect(decideAccusation(graph, holding(WELLY_ROUTE), [], { accused: "toby", cited: [] })).toBe("not_yet");
    // A cited clue must support the culprit: Mia's cake clears Mia, it does not name Toby on its own.
    expect(decideAccusation(graph, holding(["clue_thorne_mia_cake"]), [], { accused: "toby", cited: ["clue_thorne_mia_cake"] })).toBe("not_yet");
  });

  it("fails a right name with no support, with no question of its own, and loses it on the last accusation", () => {
    const play = holding(["clue_hale_key_last_seen"]);
    expect(decideAccusation(graph, play, [], { accused: "toby", cited: ["clue_hale_key_last_seen"] })).toBe("not_yet");
    expect(decideAccusation(graph, play, failures(1), { accused: "toby", cited: [] })).toBe("not_yet");
    expect(decideAccusation(graph, play, failures(2), { accused: "toby", cited: [] })).toBe("lose");
  });

  it("spends one accusation on each failure, and the third failure loses", () => {
    const play = holding(WELLY_ROUTE);
    expect(decideAccusation(graph, play, [], { accused: "dobbs", cited: ["clue_welly_prints"] })).toBe("not_yet");
    expect(decideAccusation(graph, play, failures(1), { accused: "mia", cited: [] })).toBe("not_yet");
    expect(decideAccusation(graph, play, failures(2), { accused: "mia", cited: [] })).toBe("lose");
    expect(decideAccusation(graph, play, [], { accused: null, cited: [] })).toBe("not_yet");
    // A win is decided as before, on the last accusation too.
    expect(decideAccusation(graph, play, failures(2), { accused: "toby", cited: ["clue_welly_prints"] })).toBe("win");
  });

  it("never counts a clue taken back as support", () => {
    const play = holding(WELLY_ROUTE, ["clue_thorne_mia_cake"]);
    expect(supportingClues(graph, play)).toEqual([]);
    expect(decideAccusation(graph, play, [], { accused: "toby", cited: ["clue_welly_prints"] })).toBe("not_yet");
  });

  it("points a failure at a lead on the way to the culprit before any other", () => {
    // Mr. Thorne, met first, leads nowhere new; Ms. Hale, unmet, holds the key's last sighting.
    const play = { ...holding(["thorne_alibi"]), met: ["thorne"] };
    expect(questionLead(graph, play)).toBe("You have not talked to Ms. Hale yet.");
  });
});

/** The case's events as a game history records them, with each clue's saved line. */
function history(events: ClueGraphEvent[], after: Array<{ event_type: string; payload: Record<string, unknown> }> = []) {
  const played = events.map((event, index) => ({
    sequence: index + 2,
    event_type: { move: "move", search: "search", talk: "talk", line: "ask" }[event.type],
    actor: "system",
    narration: "…",
    payload: { clue_graph: event },
  }));
  return [
    ...played,
    ...after.map((row, index) => ({ sequence: played.length + index + 2, actor: "system", narration: "Who did it?", ...row })),
  ];
}

describe("what the clue-graph accusation narrator is given", () => {
  const blueprint = buildClueGraphBlueprint(graph);
  const session = { mode: "accuse" as const, current_location_id: "greenhouse", current_talk_character_id: null, time_remaining: 4 };
  const found = history(
    [
      { type: "search", spot: "the smashed pumpkin", notebook: { clue_welly_prints: "Saved: tiny welly prints." } },
      { type: "move", location: "potting_shed" },
      {
        type: "talk",
        character: "toby",
        notebook: { toby_alibi: "Saved: home all evening.", toby_blames_thorne: "Saved: blames Mr. Thorne.", clue_toby_thorne_ladder: "Saved: Thorne up his ladder.", react_toby_sweeping: "Saved: sweeps.", react_toby_trainers: "Saved: trainers." },
      },
    ],
    [{ event_type: "accuse_start", payload: { role: "accusation_start" } }],
  );
  const held = ["clue_welly_prints", "toby_alibi", "react_toby_sweeping", "react_toby_trainers", "toby_blames_thorne", "clue_toby_thorne_ladder"];
  const secrets = [
    ...graph.truth.timeline,
    graph.truth.motive,
    ...Object.values(graph.conclusions).map((conclusion) => conclusion.text),
    ...Object.entries(graph.clues).filter(([id]) => !held.includes(id)).map(([, clue]) => clue.fact),
    // A held clue reads as its saved line, never its fact.
    ...held.map((id) => graph.clues[id].fact),
  ];

  async function request(role: "graph_accusation" | "graph_accusation_round" | "graph_ending", verdict?: AccusationVerdict) {
    return buildRoleRequest({
      game_id: "case",
      blueprint,
      session,
      role,
      player_input: "It was Toby.",
      accused: "toby",
      cited: ["clue_welly_prints"],
      conversation_history: found,
      ...(verdict ? { verdict } : {}),
    } as Parameters<typeof buildRoleRequest>[0]);
  }

  it.each([
    ["the judge", "graph_accusation", undefined],
    ["a failed accusation", "graph_accusation_round", "not_yet"],
  ] as const)("gives %s only the clues held, as their saved lines, and nothing of the truth", async (_name, role, verdict) => {
    const { prompt, context } = await request(role, verdict);
    const given = context.graph_accusation_context!;
    const visible = role === "graph_accusation" ? held : ["clue_welly_prints"];
    expect(given.held.map((entry) => [entry.id, entry.text])).toEqual(visible.map((id) => [id, expect.stringMatching(/^Saved: /)]));
    expect("ending" in given).toBe(false);
    expect("verdict" in given).toBe(false);
    // Only the accusation so far: the investigation's narration stays in the notebook.
    expect(context.conversation_history.map((entry) => entry.event_type)).toEqual(["accuse_start"]);
    const seen = `${prompt}\n${JSON.stringify(context)}`;
    for (const secret of secrets) expect(seen, secret).not.toContain(secret);
    expect(seen).not.toMatch(/"(truth|rule|culprit|timeline|motive)"/);
  });

  it("points a failure at a lead while nothing held supports the culprit", async () => {
    const notYet = await request("graph_accusation_round", "not_yet");
    expect(notYet.context.graph_accusation_context).toMatchObject({ reply: { kind: "missing", lead: expect.stringMatching(/^You have not talked to /) } });
  });

  it("tells the closing scene of a win which clues showed it, and of a loss none", () => {
    const play = holding([...WELLY_ROUTE, "react_toby_trainers"]);
    // The trainers are held and cited but support nothing; only the welly prints showed it.
    expect(verdictContext(graph, play, "win", { accused: "toby", cited: ["clue_welly_prints", "react_toby_trainers"] }).ending?.showed_it).toEqual(["clue_welly_prints"]);
    expect(verdictContext(graph, holding(["toby_confession"]), "win").ending?.showed_it).toEqual(["toby_confession"]);
    expect(verdictContext(graph, play, "lose", { accused: "mia", cited: ["clue_welly_prints"] }).ending?.showed_it).toEqual([]);
  });

  it("refuses an ending in any context but the closing scene's", async () => {
    const { context } = await request("graph_ending", "lose");
    expect(() => assertRoleContextSafety("graph_accusation_round", { ...context, role_name: "graph_accusation_round" })).toThrow(/ending/);
  });

  it.each(["win", "lose"] as const)("gives the closing scene of a %s the timeline, the culprit conclusion and the motive", async (verdict) => {
    const { role, context } = await request("graph_ending", verdict);
    expect(role).toBe("graph_ending");
    expect(context.role_name).toBe("graph_ending");
    expect(context.graph_accusation_context).toMatchObject({
      ending: {
        outcome: verdict,
        culprit: "Toby",
        what_happened: graph.conclusions.culprit_toby.text,
        timeline: graph.truth.timeline,
        motive: graph.truth.motive,
      },
    });
  });
});


const STORIES = [
  { file: "greenhouse-prizewinner", accused: "thorne", other: "mia", clear: ["clue_dobbs_crash_time", "clue_thorne_mia_cake"], cited: "clue_welly_prints", statement: "thorne_never_set_foot", speaker: "Mr. Thorne", unrelated: "clue_snapped_bench" },
  { file: "dragon-crown", accused: "sam", other: "nina", clear: ["clue_pike_saw_nina", "clue_script_cards"], cited: "clue_gold_on_steps", statement: "sam_alibi_nina", speaker: "Sam", unrelated: "clue_signin_sheet" },
];

describe.each(STORIES)("failed accusation replies on $file", (story) => {
  const caseGraph = validateClueGraph(JSON.parse(fs.readFileSync(`blueprints/clue-graph/${story.file}.json`, "utf8")));
  const culprit = culpritOf(caseGraph).character;
  const play = (held: string[], retracted: string[] = []): ClueGraphPlay => ({
    ...startPlay(caseGraph), held, retracted,
    lines: Object.fromEntries(held.map((id) => [id, `Saved line for ${id}.`])),
  });
  const reply = (held: string[], accused: string | null, cited: string[], retracted: string[] = []) =>
    accusationReply(caseGraph, play(held, retracted), { accused, cited });

  it("uses only held, live clearing support for a flaw, ahead of missing or alternative", () => {
    const state = play([...story.clear, story.unrelated]);
    expect(accusationReply(caseGraph, state, { accused: story.other, cited: [story.unrelated] })).toEqual({
      kind: "flaw", cleared_by: notebook(caseGraph, state).filter((entry) => story.clear.includes(entry.id)),
    });
    expect(reply(story.clear, story.other, [])).toMatchObject({ kind: "flaw" });
    expect(reply(story.clear, story.other, [], [story.clear[0]]).kind).toBe("missing");
  });

  it("explains a cited retraction, with its speaker, ahead of other replies", () => {
    const state = play([...story.clear, story.cited, story.statement], [story.statement]);
    expect(accusationReply(caseGraph, state, { accused: story.accused, cited: [story.statement, story.cited] })).toEqual({
      kind: "flaw", retracted: [{ statement: notebook(caseGraph, state).at(-1), taken_back_by: story.speaker }],
    });
    // Merely holding a retraction is not a flaw in an accusation that does not cite it.
    expect(reply([story.statement], culprit, [], [story.statement]).kind).toBe("missing");
  });

  it("names only graph-linked alternatives, excluding the accused and culprit", () => {
    expect(reply([story.cited], story.accused, [story.cited])).toEqual({
      kind: "alternative", people: [{ id: story.other, name: caseGraph.characters[story.other].name }],
      lead: expect.any(String),
    });
    // Even explicit links cannot admit the accused or the culprit as an alternative.
    const linked = structuredClone(caseGraph);
    linked.conclusions.extra_accused = { text: "Private", clears: story.accused, rule: { all: [story.cited, story.unrelated] } };
    linked.conclusions.extra_culprit = { text: "Private", clears: culprit, rule: { all: [story.cited, story.unrelated] } };
    const culpritRule = linked.conclusions[culpritOf(linked).conclusion];
    culpritRule.rule = { any: [culpritRule.rule, { all: [story.cited, "extra_accused", "extra_culprit"] }] };
    expect(accusationReply(linked, play([story.cited]), { accused: story.accused, cited: [story.cited] })).toMatchObject({
      kind: "alternative", people: [{ id: story.other, name: caseGraph.characters[story.other].name }],
    });
  });

  it("falls to missing when no alternative remains, including no name or no citation", () => {
    expect(reply([story.cited], story.other, [story.cited]).kind).toBe("missing");
    expect(reply([story.unrelated], story.accused, [story.unrelated]).kind).toBe("missing");
    expect(reply([story.cited], story.accused, []).kind).toBe("missing");
    expect(reply([story.cited], null, [story.cited]).kind).toBe("missing");
    expect(reply([], story.accused, [story.cited]).kind).toBe("missing");
    expect(reply([...story.clear, story.cited], story.accused, [story.cited]).kind).toBe("missing");
  });

  it("asks for a broad missing fact, identically for unsupported right and wrong names", () => {
    const right = reply([], culprit, []);
    expect(right).toEqual(reply([], story.accused, []));
    expect(right).toEqual({ kind: "missing", fact_kind: "something you can see or touch that links someone to what happened", lead: expect.any(String) });
    expect(JSON.stringify(right)).not.toContain(caseGraph.characters[culprit].name);
  });

  const scenarios = () => [
    { name: "cleared", state: play(story.clear), accused: story.other, cited: [] },
    { name: "retracted", state: play([story.statement], [story.statement]), accused: story.accused, cited: [story.statement] },
    { name: "alternative", state: play([story.cited]), accused: story.accused, cited: [story.cited] },
    { name: "missing", state: play([]), accused: culprit, cited: [] },
  ];

  it("records each reply's narrator prompt and minimal context, and the mock words its items", async () => {
    const provider = createAIProviderFromProfile({ provider: "mock", model: "mock" });
    for (const scenario of scenarios()) {
      const context = verdictContext(caseGraph, scenario.state, "not_yet", { cited: scenario.cited, accused: scenario.accused });
      expect(context.people).toEqual([{ id: scenario.accused, name: caseGraph.characters[scenario.accused].name }]);
      expect(context.held.map((entry) => entry.id)).toEqual(scenario.cited);
      expect(Object.keys(context).sort()).toEqual(["accused", "held", "people", "reply"]);
      expect(JSON.stringify(context)).not.toMatch(/"(truth|rule|culprit|verdict|timeline|motive)"/);
      for (const clue of Object.values(caseGraph.clues)) expect(JSON.stringify(context)).not.toContain(clue.fact);
      const prompt = (await loadPromptTemplate("graph_accusation_round", 8, { clueGraph: true })).replace("{{player_input}}", "My case.");
      await expect(JSON.stringify({ prompt, context }, null, 2)).toMatchFileSnapshot(`snapshots/narrator/${story.file}.reply-${scenario.name}.json`);
      const output = await provider.generateRoleOutput({ role: "graph_accusation_round", prompt, context: { graph_accusation_context: context }, parse: parseGraphAccusationRoundOutput });
      const material = context.reply!;
      if (material.kind === "flaw" && "cleared_by" in material)
        for (const clue of material.cleared_by) expect(output.narration).toContain(clue.text);
      if (material.kind === "flaw" && "retracted" in material)
        for (const clue of material.retracted) { expect(output.narration).toContain(clue.statement.text); expect(output.narration).toContain(clue.taken_back_by); }
      if (material.kind === "alternative")
        for (const person of material.people) expect(output.narration).toContain(person.name);
      if (material.kind === "missing") expect(output.narration).toContain(material.fact_kind);
      if ("lead" in material && material.lead) expect(output.narration).toContain(material.lead);
      expect(output.narration).toMatch(/\?$/);
    }
  });
});
