// The accusation on a clue-graph case: the engine's rule over the graph and
// the clues held, and what the narrator is given to word it, before the case
// is resolved and once it is.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClueGraphBlueprint, validateClueGraph, type ClueGraphCase } from "@my2/shared";
import {
  confessionClues,
  decideAccusation,
  questionLead,
  supportingClues,
  type AccusationVerdict,
} from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { startPlay, type ClueGraphEvent, type ClueGraphPlay } from "../../../packages/game-engine/src/clue-graph/play.ts";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";

function greenhouse(): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));
}

const graph = greenhouse();

/** A play holding `held`, with `retracted` taken back. */
function holding(held: string[], retracted: string[] = []): ClueGraphPlay {
  return { ...startPlay(graph), held, retracted };
}

/** Earlier accusation rounds, each saved with its decision. */
function rounds(...verdicts: AccusationVerdict[]) {
  return verdicts.map((verdict) => ({ event_type: "accuse_round", payload: { clue_graph_accusation: { accused: null, cited: [], verdict } } }));
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

  it("asks its one question when support is held but not cited", () => {
    expect(decideAccusation(graph, holding(WELLY_ROUTE), [], { accused: "toby", cited: [] })).toBe("question");
    // A cited clue must support the culprit: Mia's cake clears Mia, it does not name Toby on its own.
    expect(decideAccusation(graph, holding(["clue_thorne_mia_cake"]), [], { accused: "toby", cited: ["clue_thorne_mia_cake"] })).toBe("question");
  });

  it("asks the question once for a right name with no support, then keeps V2's rounds", () => {
    const play = holding(["clue_hale_key_last_seen"]);
    expect(decideAccusation(graph, play, [], { accused: "toby", cited: ["clue_hale_key_last_seen"] })).toBe("question");
    expect(decideAccusation(graph, play, rounds("question"), { accused: "toby", cited: [] })).toBe("not_yet");
    expect(decideAccusation(graph, play, rounds("question", "not_yet", "not_yet"), { accused: "toby", cited: [] })).toBe("lose");
  });

  it("loses a wrong name as V2 does: rounds go on, and from the third the case is lost", () => {
    const play = holding(WELLY_ROUTE);
    expect(decideAccusation(graph, play, [], { accused: "dobbs", cited: ["clue_welly_prints"] })).toBe("not_yet");
    expect(decideAccusation(graph, play, rounds("not_yet", "not_yet"), { accused: "mia", cited: [] })).toBe("not_yet");
    expect(decideAccusation(graph, play, rounds("not_yet", "not_yet", "not_yet"), { accused: "mia", cited: [] })).toBe("lose");
    expect(decideAccusation(graph, play, [], { accused: null, cited: [] })).toBe("not_yet");
  });

  it("never counts a clue taken back as support", () => {
    const play = holding(WELLY_ROUTE, ["clue_thorne_mia_cake"]);
    expect(supportingClues(graph, play)).toEqual([]);
    expect(decideAccusation(graph, play, [], { accused: "toby", cited: ["clue_welly_prints"] })).toBe("question");
  });

  it("points the question at a lead on the way to the culprit before any other", () => {
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
      conversation_history: found,
      ...(verdict ? { verdict } : {}),
    } as Parameters<typeof buildRoleRequest>[0]);
  }

  it.each([
    ["the judge", "graph_accusation", undefined],
    ["a round's question", "graph_accusation_round", "question"],
    ["a round not yet won", "graph_accusation_round", "not_yet"],
  ] as const)("gives %s only the clues held, as their saved lines, and nothing of the truth", async (_name, role, verdict) => {
    const { prompt, context } = await request(role, verdict);
    const given = context.graph_accusation_context!;
    expect(given.held.map((entry) => [entry.id, entry.text])).toEqual(held.map((id) => [id, expect.stringMatching(/^Saved: /)]));
    expect("ending" in given).toBe(false);
    // Only the accusation so far: the investigation's narration stays in the notebook.
    expect(context.conversation_history.map((entry) => entry.event_type)).toEqual(["accuse_start"]);
    const seen = `${prompt}\n${JSON.stringify(context)}`;
    for (const secret of secrets) expect(seen, secret).not.toContain(secret);
    expect(seen).not.toMatch(/"(truth|rule|culprit|timeline|motive)"/);
  });

  it.each(["win", "lose"] as const)("gives the closing scene of a %s the timeline, the culprit conclusion and the motive", async (verdict) => {
    const { role, context } = await request("graph_ending", verdict);
    expect(role).toBe("graph_ending");
    expect(context.role_name).toBe("graph_ending");
    expect(context.graph_accusation_context).toMatchObject({
      verdict,
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
