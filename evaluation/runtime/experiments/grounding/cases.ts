// Development data only. Histories are folded by the same engine as play.
import { buildRoleRequest } from "../../lib/prompt-build.ts";
import { buildNarrationMessages, buildNarrationPrompt } from "../../lib/prompt-build.ts";
import { readBlueprint, type TurnCase } from "../../lib/case.ts";
import { getAction, normalizeHistory } from "../../lib/roles.ts";
import type { NarrationRoleInput, TemplateRoleInput } from "../../../../packages/game-engine/src/role-request.ts";
import { played, readGraph, lineCase, accusationCase, type Step } from "../../cases/clue-graph/support/play.ts";
import greenhouseTalk from "../../cases/clue-graph/greenhouse/talk.ts";
import greenhouseAccuse from "../../cases/clue-graph/greenhouse/accusation.ts";
import greenhouseUnknown from "../../cases/clue-graph/greenhouse/plain-unknown.ts";
import dragonUnknown from "../../cases/clue-graph/dragon-crown/plain-unknown.ts";
import dragonTalk from "../../cases/clue-graph/dragon-crown/talk.ts";
import dragonAccuse from "../../cases/clue-graph/dragon-crown/accusation.ts";

const STORIES = ["greenhouse-prizewinner", "dragon-crown", "the-stopped-clock"];
const clock = "blueprints/clue-graph/the-stopped-clock.json";
const samMet: Step[] = [{ move: "bakery" }, { talk: "sam", narration: "Sam says he carried the rolls along the river path and came straight back. His trainers are floury and have star soles." }];
const samShown: Step[] = [...samMet, { move: "bandstand" }, { talk: "pike", narration: "Mr. Pike says he saw Ms. Fenn leave the clock tower at five to six." }, { say: "When did Sam bring the band's breakfast rolls?", reply: "Mr. Pike says Sam brought the rolls at quarter past six, from the square.", asked: ["pike_sam_late"] }, { move: "bakery" }, { talk: "sam", narration: "Sam tucks his feet away." }];
const samConfessed: Step[] = [{ move: "clock_tower" }, { search: "the stone stairs" }, ...samShown,
  { say: "Mr. Pike saw you come from the square, not the river path.", reply: "Sam admits crossing the square but denies entering the tower.", opened: ["sam_admits_square"] },
  { say: "Your star soles match the floury footprints on the tower stairs.", reply: "Sam admits stopping the clock and hiding the key so the cake could be remade.", opened: ["sam_confession"] }];
const clockLines = [
  lineCase(clock, samMet, "Did a red van drive past the tower at six?", { id: "clock-unknown", group: "unknown", expect: { revealed_clue_ids: [], input_understood: true } }),
  lineCase(clock, samMet, "You did it! Just admit everything!", { id: "clock-pressure", group: "withhold", expect: { revealed_clue_ids: [], input_understood: true } }),
  lineCase(clock, samShown, "Mr. Pike saw you bring the rolls from the town square at quarter past six, not the river path.", { id: "clock-earned", group: "earned", expect: { revealed_clue_ids: ["sam_admits_square"], input_understood: true } }),
];

function pick(cases: TurnCase[], group: string): TurnCase {
  const found = cases.find((one) => one.group === group);
  if (!found) throw new Error(`No development case for ${group}`);
  return found;
}

export function developmentCases(): TurnCase[] {
  return STORIES.flatMap((story, index) => {
    const file = `blueprints/clue-graph/${story}.json`;
    const graph = readGraph(file);
    const { history } = played(graph, []);
    const given = { mode: "explore", location_id: graph.opening.location, time_remaining: graph.metadata.time_budget, history };
    const first = Object.entries(graph.characters).find(([, person]) => person.location === graph.opening.location) ?? Object.entries(graph.characters)[0];
    const met = played(graph, [...(first[1].location === graph.opening.location ? [] : [{ move: first[1].location }]), { talk: first[0], narration: Object.values(graph.clues).filter((clue) => clue.kind !== "evidence" && clue.source.character === first[0] && clue.reached.by === "first_meeting").map((clue) => clue.fact).join(" ") }]);
    const talkGiven = { mode: "talk", location_id: met.play.at, talk_character_id: first[0], time_remaining: graph.metadata.time_budget - met.play.turns, history: met.history };
    const evidence = Object.entries(graph.clues).find(([, clue]) => clue.kind === "evidence")!;
    const source = graph.clues[evidence[0]].source as { location: string; spot?: string };
    const searched = played(graph, source.location === graph.opening.location ? [] : [{ move: source.location }]);
    const lines = index === 2 ? clockLines : [pick(index ? dragonUnknown : greenhouseUnknown, "plain-unknown"), pick(index ? dragonTalk : greenhouseTalk, "hold-pushed"), pick(index ? dragonTalk : greenhouseTalk, "shown")];
    const accusations = index === 2 ? [
      accusationCase(clock, samMet, "I think Mr. Hobbs did it.", { id: "clock-guess", group: "accusation-failure", expect: { verdict: "not_yet" } }),
      accusationCase(clock, samConfessed, "Sam did it. He confessed to stopping the clock and hiding the key so his mum could replace the cake.", { id: "clock-win", group: "ending", expect: { verdict: "win" } }),
    ] : [pick(index ? dragonAccuse : greenhouseAccuse, "accuse-nothing-cited"), pick(index ? dragonAccuse : greenhouseAccuse, "accuse-won")];
    const cases: TurnCase[] = [
      { id: "intro", blueprint: { path: file }, given: {}, action: { type: "start" } },
      { id: "arrival", blueprint: { path: file }, given, action: { type: "move", destination: graph.opening.location } },
      { id: "greeting", blueprint: { path: file }, given: { ...given, location_id: first[1].location, ...(first[1].location === graph.opening.location ? {} : { history: played(graph, [{ move: first[1].location }]).history, time_remaining: graph.metadata.time_budget - 1 }) }, action: { type: "talk", character_id: first[0] } },
      { id: "farewell", blueprint: { path: file }, given: talkGiven, action: { type: "end_talk" } },
      { id: "search-find", blueprint: { path: file }, given: { ...given, location_id: searched.play.at, time_remaining: graph.metadata.time_budget - searched.play.turns, history: searched.history }, action: { type: "search", ...(source.spot ? { search_query: source.spot } : {}) }, expect: { revealed_clue_id: evidence[0], input_understood: true } },
      { id: "search-absent", blueprint: { path: file }, given, action: { type: "search", search_query: "inside the spaceship parked here" }, expect: { revealed_clue_id: null, input_understood: true } },
      ...lines,
      { id: "accusation-start", blueprint: { path: file }, given, action: { type: "accuse" } },
      ...accusations,
    ];
    return cases.map((one, slot) => ({ ...one, id: `${story}-${slot + 1}-${one.id}`, group: one.expect ? (one.group ?? one.id) : undefined, judges: ["flesch", "age_appropriate_turn", "gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"] }));
  });
}

/** Saved before a batch: the exact reconstructed inputs, including both accusation inputs as they occur in replay logs. */
export async function developmentInputs(root: string) {
  return Promise.all(developmentCases().map(async (testCase) => {
    const { blueprint } = await readBlueprint(testCase.blueprint.path, root);
    const input = getAction(testCase.action.type).roleInput(testCase.given, testCase.action, blueprint, normalizeHistory(testCase.given.history));
    const messages = input.role === "intro" || input.role === "ambience"
      ? buildNarrationMessages(buildNarrationPrompt(input as unknown as NarrationRoleInput))
      : await buildRoleRequest(input as unknown as TemplateRoleInput);
    return { id: testCase.id, ...messages };
  }));
}
