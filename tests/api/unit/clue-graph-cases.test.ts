// The clue-graph narrator case library (`evaluation/runtime/cases/clue-graph/`)
// and the talk prompt it measures: every case loads, plays a history the engine
// could have recorded, and expects only what its state offers; and the talk
// prompt is one prompt for every character and state, with no section per
// mechanism. No model is called.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";
import type { AIContext } from "../../../packages/game-engine/src/ai-context.ts";
import { linesThisConversation } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { GRAPH_TALK_PROMPT } from "../../../packages/game-engine/src/clue-graph/prompts.ts";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { loadCasesFrom, readBlueprint, type TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { validateExpect } from "../../../evaluation/runtime/lib/expect.ts";
import { getAction, normalizeHistory } from "../../../evaluation/runtime/lib/roles.ts";
import { played, readGraph } from "../../../evaluation/runtime/cases/clue-graph/support/play.ts";
import { judgeReport, type AccusationReport, type GraphVerdictContext } from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { parseGraphAccusationRoundOutput, parseGraphEndingOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import { playOf } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { PHYSICAL_FINDING, TAKEN_BACK, WHO_WAS_WHERE } from "../../../evaluation/runtime/cases/clue-graph/support/details.ts";
import { gradeExpect } from "../../../evaluation/runtime/lib/expect.ts";
import type { StoredTurn } from "../../../evaluation/runtime/lib/turn.ts";
import { makeTurn } from "./runtime-turn-helpers.ts";

/** One group per kind of accusation (`evaluation/runtime/cases/clue-graph/greenhouse/accusation.ts`). */
const ACCUSE_GROUPS = ["accuse-cleared", "accuse-alternative", "accuse-nothing-cited", "accuse-unsupported", "accuse-retracted", "accuse-won"];

/** A story's case library and its case file. */
const STORIES = [
  { name: "greenhouse", library: "evaluation/runtime/cases/clue-graph/greenhouse", file: "blueprints/clue-graph/greenhouse-prizewinner.json" },
  { name: "dragon-crown", library: "evaluation/runtime/cases/clue-graph/dragon-crown", file: "blueprints/clue-graph/dragon-crown.json" },
] as const;
const GREENHOUSE = STORIES[0].file;

interface Built {
  turnCase: TurnCase;
  prompt: string;
  context: AIContext;
}

async function buildAll({ library, file } = STORIES[0] as (typeof STORIES)[number]): Promise<Built[]> {
  const cases = await loadCasesFrom(library);
  const { blueprint } = await readBlueprint(file, process.cwd());
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

describe.each(STORIES)("the clue-graph $name case library", async (story) => {
  const built = await buildAll(story);
  const graph = readGraph(story.file);

  it("loads, with unique IDs, a graded expect and a group on every case", () => {
    expect(built.length).toBeGreaterThan(30);
    expect(new Set(built.map(({ turnCase }) => turnCase.id)).size).toBe(built.length);
    for (const { turnCase } of built) {
      expect(() => validateExpect(turnCase), turnCase.id).not.toThrow();
      expect(turnCase.blueprint.path, turnCase.id).toBe(story.file);
      expect(turnCase.group, turnCase.id).toMatch(/^(shown|shown-after-dodge|bluffed|worded-line|asked|confession|hold-[a-z-]+|search-[a-z]+|whole-fact|plain-unknown|invention|accuse-[a-z-]+)$/);
    }
  });

  it("covers every kind the narrator is measured on", () => {
    const groups = new Set(built.map(({ turnCase }) => turnCase.group));
    for (const kind of ["shown", "asked", "worded-line", "bluffed", "shown-after-dodge", "hold-pushed", "hold-small-talk", "search-spot", "search-plain", "search-nothing", "whole-fact", "plain-unknown", "invention", ...ACCUSE_GROUPS])
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
      if (turnCase.group!.startsWith("hold-") || ["plain-unknown", "invention"].includes(turnCase.group!)) {
        expect(expected, turnCase.id).toEqual([]);
        expect(offers.size, `${turnCase.id} offers nothing to hold back`).toBeGreaterThan(0);
      } else {
        expect(expected.length, turnCase.id).toBeGreaterThan(0);
      }
    }
  });

  it("bluffs only gates it may, with nothing held to show, shows only what is held, and a held-not-used case holds what it does not use", () => {
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
    // A shown case holds what it shows, or it would be a bluff scored as a show.
    for (const one of talk.filter(({ turnCase }) => ["shown", "shown-after-dodge"].includes(turnCase.group!))) {
      const opened = gatesOf(one).filter((gate) => one.turnCase.expect!.revealed_clue_ids!.includes(gate.id));
      expect(opened.length, one.turnCase.id).toBeGreaterThan(0);
      for (const gate of opened)
        expect(gate.opens_with.show?.clues.some((clue) => clue.held), `${one.turnCase.id}: ${gate.id} is bluffed, not shown`).toBe(true);
    }
    for (const one of talk.filter(({ turnCase }) => turnCase.group === "hold-held-not-used")) {
      const held = gatesOf(one).flatMap((gate) => gate.opens_with.show?.clues ?? []).filter((clue) => clue.held);
      expect(held.length, `${one.turnCase.id} holds nothing it could use`).toBeGreaterThan(0);
    }
  });

  it("names, for each whole-fact clue, details its fact holds, and judges each new group", () => {
    const groups = { "whole-fact": "gm_clue_discipline", "plain-unknown": "gm_fabrication", invention: "gm_fabrication" } as const;
    for (const { turnCase } of built) {
      const judge = groups[turnCase.group as keyof typeof groups];
      if (!judge) continue;
      expect(Object.keys(turnCase.expect!.judges ?? {}), turnCase.id).toEqual([judge]);
      if (turnCase.group !== "whole-fact") continue;
      const entries = Object.entries(turnCase.expect!.whole_fact ?? {});
      expect(entries.length, turnCase.id).toBeGreaterThan(0);
      for (const [id, details] of entries) {
        const fact = graph.clues[id].fact.toLowerCase();
        for (const detail of details) {
          const spellings = typeof detail === "string" ? [detail] : detail;
          expect(spellings.some((spelling) => fact.includes(spelling.toLowerCase())), `${turnCase.id}: ${spellings[0]} is not in ${id}'s fact`).toBe(true);
        }
      }
    }
  });

  it("hands the narrator the made-up detail an invention case keeps to", () => {
    const KEPT: Record<string, string> = {
      "invent-kept-dobbs-cat": "Biscuit",
      "invent-kept-greenhouse-revisit": "Rain drums on the glass roof",
      "invent-kept-sam-comic": "Captain Comet",
      "invent-kept-library-revisit": "Rain streaks the library windows",
    };
    const kept = built.filter(({ turnCase }) => turnCase.id.startsWith("invent-kept-"));
    expect(kept.length).toBe(2);
    for (const { turnCase, context } of kept) {
      const detail = KEPT[turnCase.id];
      expect(detail, turnCase.id).toBeDefined();
      // Made up on an earlier turn, and in what this turn's narrator reads.
      expect((turnCase.given.history ?? []).some((row) => row.narration?.includes(detail)), turnCase.id).toBe(true);
      expect(JSON.stringify(context), turnCase.id).toContain(detail);
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
      // Opening the accusation scene records no clue-graph event.
      const recorded = (turnCase.given.history ?? []).every((row) => row.event_type === "accuse_start" || row.payload?.clue_graph !== undefined);
      expect(recorded, turnCase.id).toBe(true);
    }
    const greenhouse = readGraph(GREENHOUSE);
    expect(() =>
      played(greenhouse, [{ move: "thorne_garden" }, { talk: "thorne", narration: "Hello." }, { say: "Hi.", reply: "Hm.", opened: ["toby_confession"] }]),
    ).toThrow(/toby_confession/);
    expect(() => played(greenhouse, [{ say: "Hi.", reply: "Hm." }])).toThrow(/outside a conversation/);
  });
});

/** What each accusation case's line means: who it names and which held clues it cites. */
const REPORTS: Record<string, AccusationReport> = {
  "accuse-mia-cleared": { accused: "mia", cited: ["clue_rota_purple_ink"] },
  "accuse-hale-alternative": { accused: "hale", cited: ["clue_spare_key_book", "clue_key_in_water_butt"] },
  "accuse-dobbs-nothing-cited": { accused: "dobbs", cited: [] },
  "accuse-toby-unsupported": { accused: "toby", cited: ["react_toby_sweeping", "react_toby_trainers"] },
  "accuse-thorne-retracted": { accused: "thorne", cited: ["toby_blames_thorne"] },
  "accuse-toby-won": { accused: "toby", cited: ["clue_welly_prints", "clue_thorne_mia_cake"] },
  "accuse-nina-cleared": { accused: "nina", cited: ["abara_nina_jumper"] },
  "accuse-pike-alternative": { accused: "pike", cited: ["clue_gold_on_steps", "clue_glue_out"] },
  "accuse-sam-nothing-cited": { accused: "sam", cited: [] },
  "accuse-leo-unsupported": { accused: "leo", cited: ["react_leo_seat", "clue_gold_on_steps"] },
  "accuse-nina-retracted": { accused: "nina", cited: ["leo_blames_nina"] },
  "accuse-leo-won": { accused: "leo", cited: ["clue_pike_saw_bundle", "clue_crown_behind_dragon"] },
};

describe.each(STORIES)("the clue-graph $name accusation cases", async (story) => {
  const graph = readGraph(story.file);
  const accusations = (await loadCasesFrom(story.library)).filter((turnCase) => turnCase.action.type === "accuse");

  it("has a case per kind of accusation, each opened in the scene with turns left", () => {
    expect(new Set(accusations.map((turnCase) => turnCase.group))).toEqual(new Set(ACCUSE_GROUPS));
    for (const turnCase of accusations) {
      expect(turnCase.given.mode, turnCase.id).toBe("accuse");
      expect(turnCase.given.history!.at(-1)!.event_type, turnCase.id).toBe("accuse_start");
      expect(turnCase.given.time_remaining, turnCase.id).toBeGreaterThan(0);
    }
  });

  it("expects what the engine decides on the report its line means, and hands only what the engine hands", async () => {
    const { blueprint } = await readBlueprint(story.file, process.cwd());
    for (const turnCase of accusations) {
      const report = REPORTS[turnCase.id];
      expect(report, `${turnCase.id} has no report`).toBeDefined();
      const history = normalizeHistory(turnCase.given.history);
      const play = playOf(graph, history);
      for (const id of report.cited) expect(play.held, `${turnCase.id}: ${id}`).toContain(id);
      const judged = judgeReport(graph, history, { accused_character_id: report.accused, cited_clue_ids: report.cited })!;
      expect(judged.saved.verdict, turnCase.id).toBe(turnCase.expect!.verdict);
      expect(judged.notHeld, turnCase.id).toEqual([]);
      const ended = judged.result !== null;
      expect(judged.result, turnCase.id).toBe(ended ? judged.saved.verdict : null);
      expect(judged.reply.role, turnCase.id).toBe(ended ? "graph_ending" : "graph_accusation_round");
      expect(judged.parse, turnCase.id).toBe(ended ? parseGraphEndingOutput : parseGraphAccusationRoundOutput);
      const input = getAction("accuse").roleInput(turnCase.given, turnCase.action, blueprint as never, history);
      const { context } = await buildRoleRequest({ ...input, ...judged.reply } as never);
      const verdictContext = context.graph_accusation_context as GraphVerdictContext;
      // A failure is judged for spoilers; the closing scene cannot spoil.
      if (ended) {
        expect(turnCase.expect!.reply_kind, turnCase.id).toBeUndefined();
        expect(turnCase.expect!.judges, turnCase.id).toBeUndefined();
      } else {
        expect(verdictContext.reply!.kind, turnCase.id).toBe(turnCase.expect!.reply_kind);
        expect(turnCase.expect!.judges, turnCase.id).toEqual({ gm_spoiler: "given_away" });
      }
      // A field's name says what it holds: `taken_back_by` hands that a statement was taken back.
      const handed = JSON.stringify(ended ? verdictContext.ending : verdictContext.reply).toLowerCase().replace(/_/g, " ");
      expect(turnCase.expect!.handed!.length, turnCase.id).toBeGreaterThan(0);
      for (const detail of turnCase.expect!.handed!) {
        const spellings = typeof detail === "string" ? [detail] : detail;
        expect(spellings.some((spelling) => handed.includes(spelling.toLowerCase())), `${turnCase.id}: ${spellings[0]} is not handed`).toBe(true);
      }
    }
  });

  it("refuses a report naming someone the case does not hold, and drops a cited clue not held", () => {
    const history = normalizeHistory(accusations[0].given.history);
    expect(judgeReport(graph, history, { accused_character_id: "nobody_in_the_case", cited_clue_ids: [] })).toBeNull();
    const notHeld = Object.keys(graph.clues).find((id) => !playOf(graph, history).held.includes(id))!;
    const judged = judgeReport(graph, history, { accused_character_id: null, cited_clue_ids: [notHeld] })!;
    expect(judged.notHeld).toEqual([notHeld]);
    expect(judged.saved.cited).toEqual([]);
  });
});

/** The shared spellings of what a reply must state, beside the words a reply uses for anything else. */
const STATED = [TAKEN_BACK, WHO_WAS_WHERE, PHYSICAL_FINDING];

describe.each(STORIES)("the clue-graph $name accusation spellings", async (story) => {
  const accusations = (await loadCasesFrom(story.library)).filter((turnCase) => turnCase.action.type === "accuse");

  it("withhold a kind of fact or a retraction from a reply that gives everything else and a closing question", () => {
    const stating = accusations.filter((turnCase) => turnCase.expect!.handed!.some((detail) => STATED.includes(detail as string[])));
    expect(stating.length, "a missing case and a retracted case at least").toBeGreaterThanOrEqual(3);
    for (const turnCase of stating) {
      const { verdict, reply_kind, handed } = turnCase.expect!;
      const named = handed!.filter((detail) => !STATED.includes(detail as string[])).map((detail) => (typeof detail === "string" ? detail : detail[0]));
      // Every word here is one a reply uses without stating the thing: a lead, a look, a taken crown.
      const narration = `${named.join(" and ")} talked about it, and no longer looks cross. Maybe ${named[0]} knows more. What links ${named[0]} to this, and what ties it together? Who really took it, and who was there? Where will you look next, and what will you find?`;
      const base = makeTurn({ action: turnCase.action });
      const turn: StoredTurn = { ...base, response: { ...base.response, output_role: "graph_accusation_round", action: "accuse", narration_text: narration, raw: { narration, clue_graph_accusation: { verdict }, reply_kind } } };
      const grade = gradeExpect({ verdict, reply_kind, handed }, turn, []);
      expect(grade.details, turnCase.id).toMatchObject({ erred: ["withheld"] });
      expect((grade.details as { missing_handed: string[] }).missing_handed, turnCase.id).toHaveLength(1);
    }
  });
});

describe.each(STORIES)("the clue-graph $name case library, offline", (story) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `mystery-clue-graph-${story.name}-`));
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("runs every case on the stub narrator and judge, each graded without a model", async () => {
    const lines: string[] = [];
    const code = await runEval(
      ["judge", "turn", story.library, "--narrator", "narrator-stub", "--judge-binding", "judge-stub", "--samples", "1", "--output-root", scratch],
      { root: process.cwd(), out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
      COMMANDS,
    );
    // The canned narrator reveals nothing, so cases expecting a clue fail (exit 2), but none errs (exit 1).
    expect(code, lines.join("\n")).toBe(2);
    const [day] = fs.readdirSync(scratch);
    const summary = readSummary(path.join(scratch, day, fs.readdirSync(path.join(scratch, day))[0]));
    expect(summary.complete).toBe(true);
    const groups = summary.narrators[0].groups;
    expect(groups.every((group) => group.incomplete === 0)).toBe(true);
    expect(groups.map((group) => group.group)).toEqual(expect.arrayContaining(["whole-fact", "plain-unknown", "invention", ...ACCUSE_GROUPS]));
  }, 120_000);
});

describe("the clue-graph talk prompt", async () => {
  const built = (await Promise.all(STORIES.map((story) => buildAll(story)))).flat().filter(({ turnCase }) => turnCase.action.type === "ask");

  /** The prompt with what each case fills in taken out. */
  function template({ prompt, context, turnCase }: Built): string {
    const talk = context.graph_talk_context!;
    return prompt
      .replace(/\nEarlier in this conversation, they said:\n(- ".*"\n)+A clue used .*/, "")
      .split(`"${turnCase.action.player_input}"`).join('"<line>"')
      .split(talk.location_name).join("<location>")
      .split(talk.character.name).join("<character>");
  }

  it("is written from the objective, in three sections", () => {
    expect(GRAPH_TALK_PROMPT.match(/^## .+$/gm)).toEqual(["## What you are given", "## What this line earns", "## The notebook"]);
    expect(GRAPH_TALK_PROMPT).toContain("The game rewards real detective work at once. Be generous about how the investigator puts things");
    expect(GRAPH_TALK_PROMPT).toContain("and strict about what they actually do.");
  });

  it("is the same prompt for every character and state, with no section added per mechanism", () => {
    // The reader's age sets the reading level, so each story has one prompt of its own.
    for (const { file } of STORIES) {
      const cases = built.filter(({ turnCase }) => turnCase.blueprint.path === file);
      expect(cases.length, file).toBeGreaterThan(0);
      expect(new Set(cases.map(template)).size, file).toBe(1);
    }
    // The reader's age also sets a notebook line's length.
    const templates = new Set(
      built.map(template).map((text) => text.replace(/\nThe reader is [\s\S]*?\n(?=## )/, "\n").replace(/about \d+ words/, "about <n> words")),
    );
    expect(templates.size).toBe(1);
    const [only] = templates;
    expect(only.match(/^## .+$/gm)).toEqual([
      "## Narration style",
      "## What you may make up",
      "## What you are given",
      "## What this line earns",
      "## The notebook",
    ]);
    expect(only).not.toMatch(/agenda|self.protect|commitment|fallback|## (Locked|Reactions|Held-back)/i);
  });

  it("restates the investigator's earlier lines in this conversation beside the line, and only those", () => {
    const followUp = built.find(({ turnCase }) => turnCase.id === "toby-glass-follow-up")!;
    expect(followUp.prompt).toContain('Earlier in this conversation, they said:\n- "toby the glass from the window was OUTSIDE on the path not inside"\nA clue used in one of those lines still counts now. If its gate is still in gates, Toby dodged it once already');
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
