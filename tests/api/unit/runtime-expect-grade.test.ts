// Grading a case's `expect` by code, and summing samples per case and per group.
// Pure functions over captured turns: no narrator, no judge model.

import { describe, expect, it } from "vitest";

import type { RunInfo, Verdict } from "../../../evaluation/core/result.ts";
import type { Expect, TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { gradeExpect, validateExpect } from "../../../evaluation/runtime/lib/expect.ts";
import { formatComparison, formatSummary, summarizeSamples } from "../../../evaluation/runtime/lib/expect-summary.ts";
import type { Sample } from "../../../evaluation/runtime/lib/expect-summary.ts";
import type { StoredTurn } from "../../../evaluation/runtime/lib/turn.ts";
import { makeTurn } from "./runtime-turn-helpers.ts";

function searchTurn(raw: Record<string, unknown>): StoredTurn {
  const turn = makeTurn({ action: { type: "search", search_query: "the pantry shelf" } });
  return { ...turn, response: { ...turn.response, output_role: "graph_search", action: "search", raw: { narration: "You look.", ...raw } } };
}

/** A CLI narrator's talk reply: the gates it opened and the questions it answered. */
function askTurn(raw: Record<string, unknown>): StoredTurn {
  const turn = makeTurn();
  return { ...turn, response: { ...turn.response, raw: { narration: "Alice shrugs.", opened: [], answered: [], notebook: [], ...raw } } };
}

/** A talk turn as a server saved it, which is where a recorded use is read from. */
function servedAsk(payload: Record<string, unknown>): StoredTurn {
  const turn = makeTurn({ narrator: "server" });
  return {
    ...turn,
    response: { ...turn.response, raw: { kind: "turn", events: [{ event_type: "ask", payload: { revealed_clue_ids: [], input_understood: true, ...payload } }] } },
  };
}

function details(verdict: Verdict) {
  return verdict.details as { erred: string[]; use: string | null };
}

function graded(expectation: Expect, turn: StoredTurn, verdicts: Verdict[] = []) {
  const verdict = gradeExpect(expectation, turn, verdicts);
  return { status: verdict.status, erred: verdict.details ? details(verdict).erred : null, use: verdict.details ? details(verdict).use : null, reason: verdict.reason };
}

describe("grading a search's revealed_clue_id", () => {
  it("is right when the expected clue is revealed", () => {
    expect(graded({ revealed_clue_id: "clue-jar" }, searchTurn({ revealed_clue_id: "clue-jar" }))).toMatchObject({ status: "pass", erred: [] });
  });

  it("withheld when the expected clue is missing", () => {
    expect(graded({ revealed_clue_id: "clue-jar" }, searchTurn({ revealed_clue_id: null }))).toMatchObject({ status: "fail", erred: ["withheld"] });
  });

  it("is right on an expected null, and gave away when a clue came anyway", () => {
    expect(graded({ revealed_clue_id: null }, searchTurn({ revealed_clue_id: null })).status).toBe("pass");
    expect(graded({ revealed_clue_id: null }, searchTurn({ revealed_clue_id: "clue-jar" }))).toMatchObject({ status: "fail", erred: ["given_away"] });
  });

  it("errs both ways when another clue came instead", () => {
    expect(graded({ revealed_clue_id: "clue-jar" }, searchTurn({ revealed_clue_id: "clue-crumb" })).erred).toEqual(["withheld", "given_away"]);
  });

  it("reads what the game reads: a search not understood reveals nothing", () => {
    const turn = searchTurn({ revealed_clue_id: "clue-jar", input_understood: false });
    expect(graded({ revealed_clue_id: "clue-jar", input_understood: true }, turn).erred).toEqual(["withheld", "misread"]);
  });
});

describe("grading a talk turn", () => {
  it("compares revealed_clue_ids as a set, in both directions", () => {
    expect(graded({ revealed_clue_ids: ["a", "b"] }, askTurn({ answered: ["b", "a"] })).status).toBe("pass");
    expect(graded({ revealed_clue_ids: ["a", "b"] }, askTurn({ answered: ["a"] })).erred).toEqual(["withheld"]);
    expect(graded({ revealed_clue_ids: ["a"] }, askTurn({ answered: ["a", "b"] })).erred).toEqual(["given_away"]);
  });

  it("holds an empty expectation to nothing given", () => {
    expect(graded({ revealed_clue_ids: [] }, askTurn({ answered: [] })).status).toBe("pass");
    expect(graded({ revealed_clue_ids: [] }, askTurn({ answered: ["a"] })).erred).toEqual(["given_away"]);
  });

  it("grades used_clue_ids in both directions", () => {
    expect(graded({ used_clue_ids: ["gate"] }, servedAsk({ used_clue_ids: ["gate"] })).status).toBe("pass");
    expect(graded({ used_clue_ids: ["gate"] }, servedAsk({ used_clue_ids: [] })).erred).toEqual(["withheld"]);
    expect(graded({ used_clue_ids: [] }, servedAsk({ used_clue_ids: ["gate"] })).erred).toEqual(["given_away"]);
  });

  it("grades input_understood both ways", () => {
    expect(graded({ input_understood: true }, askTurn({ input_understood: false })).erred).toEqual(["misread"]);
    expect(graded({ input_understood: false }, askTurn({ input_understood: true })).erred).toEqual(["misread"]);
    expect(graded({ input_understood: true }, askTurn({})).status).toBe("pass");
  });

  it("says a withheld clue went unseen when the use is missing", () => {
    const turn = servedAsk({ revealed_clue_ids: [], used_clue_ids: [] });
    expect(graded({ revealed_clue_ids: ["admission"], used_clue_ids: ["gate"] }, turn)).toMatchObject({ erred: ["withheld"], use: "unseen" });
  });

  it("says a withheld clue was seen and refused when the use is there", () => {
    const turn = servedAsk({ revealed_clue_ids: [], used_clue_ids: ["gate"] });
    expect(graded({ revealed_clue_ids: ["admission"], used_clue_ids: ["gate"] }, turn)).toMatchObject({ erred: ["withheld"], use: "refused" });
  });

  it("says nothing of the use when the case names none, or nothing was withheld", () => {
    expect(graded({ revealed_clue_ids: ["admission"] }, servedAsk({ revealed_clue_ids: [], used_clue_ids: ["gate"] })).use).toBeNull();
    expect(graded({ revealed_clue_ids: [], used_clue_ids: ["gate"] }, servedAsk({ revealed_clue_ids: ["x"], used_clue_ids: ["gate"] })).use).toBeNull();
  });

  it("reads a server's saved event rather than a role reply", () => {
    const turn = askTurn({});
    const served = {
      ...turn,
      narrator: "server",
      response: {
        ...turn.response,
        raw: { kind: "turn", events: [{ event_type: "ask", payload: { revealed_clue_ids: ["a"], used_clue_ids: ["gate"], input_understood: true } }] },
      },
    };
    expect(graded({ revealed_clue_ids: ["a"], used_clue_ids: ["gate"], input_understood: true }, served).status).toBe("pass");
  });

  it("cannot grade a reply the role's contract refuses", () => {
    const verdict = graded({ revealed_clue_ids: [] }, askTurn({ narration: "" }));
    expect(verdict.status).toBe("error");
    expect(verdict.reason).toContain("cannot read the narrator's output");
  });
});

describe("grading a clue-graph reply", () => {
  /** A clue-graph talk reply, its narration as the game shows it. */
  function graphTalk(narration: string, reply: Record<string, unknown>): StoredTurn {
    const turn = makeTurn();
    return {
      ...turn,
      response: { ...turn.response, output_role: "graph_talk", narration_text: narration, raw: { narration, opened: [], answered: [], notebook: [], input_understood: true, ...reply } },
    };
  }
  const CAKE = { revealed_clue_ids: ["cake"], whole_fact: { cake: ["Mia", ["nine", "9:00"], "cake tent"] } };
  const said = (narration: string, line: string) => graphTalk(narration, { answered: ["cake"], notebook: [{ id: "cake", line }] });
  const missing = (verdict: Verdict) => (verdict.details as { missing_details: unknown[] }).missing_details;

  it("is right when the narration and the clue's line both carry every detail, in any accepted spelling", () => {
    const verdict = gradeExpect(CAKE, said("At 9:00 he bought cake from Mia at the cake tent.", "Mr. Thorne says he bought cake from Mia at the Cake Tent at nine."), []);
    expect(verdict.status).toBe("pass");
    expect(missing(verdict)).toEqual([]);
  });

  it("withholds a detail left out of the narration or the line, and says which and where", () => {
    const verdict = gradeExpect(CAKE, said("He bought cake from Mia at nine.", "Mr. Thorne says he bought cake at the cake tent at nine."), []);
    expect(details(verdict).erred).toEqual(["withheld"]);
    expect(missing(verdict)).toEqual([
      { clue: "cake", detail: "Mia", from: "notebook" },
      { clue: "cake", detail: "cake tent", from: "narration" },
    ]);
  });

  it("lets the narration refer back to a detail the player just named, but never the line", () => {
    const turn = said("\"Yes, she did. At nine, at the cake tent.\"", "Mr. Thorne says he bought cake from Mia at the cake tent at nine.");
    const asked = { ...turn, action: { type: "ask", player_input: "Did you buy cake from Mia?" } };
    expect(gradeExpect(CAKE, asked, []).status).toBe("pass");
    expect(missing(gradeExpect(CAKE, turn, []))).toEqual([{ clue: "cake", detail: "Mia", from: "narration" }]);
    const vague = said("\"Yes. At nine, at the cake tent.\"", "Mr. Thorne says he bought cake at the cake tent at nine.");
    expect(missing(gradeExpect(CAKE, { ...vague, action: asked.action }, []))).toEqual([{ clue: "cake", detail: "Mia", from: "notebook" }]);
  });

  it("matches whole words only, so a time is not found inside another word", () => {
    const verdict = gradeExpect({ revealed_clue_ids: ["cake"], whole_fact: { cake: ["nine"] } }, said("Ninety cakes.", "Ninety cakes."), []);
    expect(missing(verdict)).toHaveLength(2);
  });

  it("leaves a clue that never came out to the id check", () => {
    const verdict = gradeExpect(CAKE, graphTalk("Mr. Thorne grunts.", {}), []);
    expect(details(verdict).erred).toEqual(["withheld"]);
    expect(missing(verdict)).toEqual([]);
  });

  it("reads the line a server saved, keyed by clue", () => {
    const turn = said("At nine he bought cake from Mia at the cake tent.", "");
    const served = {
      ...turn,
      narrator: "server",
      response: {
        ...turn.response,
        raw: { kind: "turn", events: [{ payload: { revealed_clue_ids: ["cake"], clue_graph: { notebook: { cake: "Mia sold him cake at the cake tent at nine." } } } }] },
      },
    };
    expect(gradeExpect(CAKE, served, []).status).toBe("pass");
  });

  it("counts a tell that comes out with its statement whether or not the reply listed it", () => {
    const comesWith = (id: string) => (id === "no_key" ? ["pats_pocket"] : []);
    const listed = graphTalk("He pats his pocket.", { answered: ["no_key", "pats_pocket"] });
    const unlisted = graphTalk("He pats his pocket.", { answered: ["no_key"] });
    expect(gradeExpect({ revealed_clue_ids: ["no_key"] }, listed, [], comesWith).status).toBe("pass");
    expect(gradeExpect({ revealed_clue_ids: ["no_key"] }, unlisted, [], comesWith).status).toBe("pass");
    expect(gradeExpect({ revealed_clue_ids: ["no_key"] }, listed, []).status).toBe("fail");
  });

  it("refuses a whole_fact for a clue the case does not expect, or with no details", () => {
    const base = { id: "c", blueprint: { path: "b.json" }, given: {}, action: { type: "ask" } } as TurnCase;
    expect(() => validateExpect({ ...base, expect: CAKE })).not.toThrow();
    expect(() => validateExpect({ ...base, expect: { revealed_clue_ids: [], whole_fact: { cake: ["Mia"] } } })).toThrow(/not a clue the case expects/);
    expect(() => validateExpect({ ...base, expect: { revealed_clue_ids: ["cake"], whole_fact: { cake: [] } } })).toThrow(/must list details/);
    expect(() => validateExpect({ ...base, expect: { revealed_clue_ids: ["cake"], whole_fact: { cake: [[""]] } } })).toThrow(/must list details/);
  });
});

describe("a judge-graded case", () => {
  const roleplay = (status: Verdict["status"]): Verdict => ({ id: "gm_roleplay", tier: "judge", status });

  it("is right when the judge passes, and errs the way the case says when it fails", () => {
    const expectation: Expect = { used_clue_ids: ["gate"], judges: { gm_roleplay: "withheld" } };
    const turn = servedAsk({ used_clue_ids: ["gate"] });
    expect(graded(expectation, turn, [roleplay("pass")]).status).toBe("pass");
    expect(graded(expectation, turn, [roleplay("fail")])).toMatchObject({ erred: ["withheld"], use: "refused" });
    expect(graded({ judges: { gm_roleplay: "given_away" } }, turn, [roleplay("fail")]).erred).toEqual(["given_away"]);
    expect(graded({ judges: { gm_roleplay: "either" } }, turn, [roleplay("fail")]).erred).toEqual(["judged"]);
  });

  it("cannot grade a sample whose judge could not judge", () => {
    const turn = askTurn({});
    expect(graded({ judges: { gm_roleplay: "withheld" } }, turn, [roleplay("error")]).status).toBe("error");
    expect(graded({ judges: { gm_roleplay: "withheld" } }, turn, []).status).toBe("error");
  });
});

describe("grading a clue-graph accusation", () => {
  /** A chained CLI accusation: the engine's decision kept beside the reply, as `replay-cli.ts` stores it. */
  function accuseTurn(narration: string, decided: { verdict: string; reply_kind?: string }): StoredTurn {
    const turn = makeTurn({ action: { type: "accuse", player_reasoning: "It was Mia, she wrote on the rota." } });
    const { verdict, reply_kind } = decided;
    const outputRole = verdict === "not_yet" ? "graph_accusation_round" : "graph_ending";
    const raw = { role: outputRole, narration, report: {}, clue_graph_accusation: { accused: "mia", cited: [], verdict }, ...(reply_kind ? { reply_kind } : {}) };
    return { ...turn, response: { ...turn.response, output_role: outputRole, action: "accuse", narration_text: narration, raw } };
  }
  const FLAW: Expect = { verdict: "not_yet", reply_kind: "flaw", handed: [["ten to nine", "8:50"], "cake"] };
  const told = "Mr. Dobbs heard the crash at 8:50, and Mia was selling cake across town.";
  const spoiler = (status: Verdict["status"]): Verdict => ({ id: "gm_spoiler", tier: "judge", status });

  it("is right when the engine decided as the case expects and the reply carries everything handed", () => {
    const verdict = gradeExpect(FLAW, accuseTurn(told, { verdict: "not_yet", reply_kind: "flaw" }), []);
    expect(verdict.status).toBe("pass");
    expect(verdict.details).toMatchObject({
      erred: [],
      accusation: { verdict: { expected: "not_yet", actual: "not_yet" }, reply_kind: { expected: "flaw", actual: "flaw" } },
      missing_handed: [],
    });
  });

  it("misread when the report led the engine to another verdict or another kind of reply", () => {
    expect(graded(FLAW, accuseTurn(told, { verdict: "win" })).erred).toEqual(["misread"]);
    expect(graded(FLAW, accuseTurn(told, { verdict: "not_yet", reply_kind: "missing" })).erred).toEqual(["misread"]);
    expect(graded({ verdict: "win" }, accuseTurn(told, { verdict: "not_yet", reply_kind: "flaw" })).erred).toEqual(["misread"]);
  });

  it("withheld what was handed and left out of the reply, naming it, whatever the player said", () => {
    const verdict = gradeExpect(FLAW, accuseTurn("Mia was selling cake.", { verdict: "not_yet", reply_kind: "flaw" }), []);
    expect(verdict.details).toMatchObject({ erred: ["withheld"], missing_handed: ["ten to nine"] });
    // The player's line names the rota, but only the reply counts.
    expect(graded({ handed: ["rota"] }, accuseTurn(told, { verdict: "not_yet", reply_kind: "flaw" })).erred).toEqual(["withheld"]);
  });

  it("gave away what the spoiler judge found, and errs every way at once", () => {
    const expectation: Expect = { ...FLAW, judges: { gm_spoiler: "given_away" } };
    expect(graded(expectation, accuseTurn(told, { verdict: "not_yet", reply_kind: "flaw" }), [spoiler("pass")]).status).toBe("pass");
    expect(graded(expectation, accuseTurn(told, { verdict: "not_yet", reply_kind: "flaw" }), [spoiler("fail")]).erred).toEqual(["given_away"]);
    expect(graded(expectation, accuseTurn("Hmm.", { verdict: "not_yet", reply_kind: "alternative" }), [spoiler("fail")]).erred).toEqual(["withheld", "given_away", "misread"]);
  });

  it("reads the accusation a server saved on its event", () => {
    const turn = makeTurn({ action: { type: "accuse", player_reasoning: "Mia did it." } });
    const event = { event_type: "accuse_failed", payload: { role: "graph_accusation_round", clue_graph_accusation: { accused: "mia", cited: [], verdict: "not_yet" }, reply_kind: "flaw" } };
    const played = { ...turn, narrator: "server", response: { ...turn.response, action: "accuse", narration_text: told, raw: { kind: "turn", events: [event] } } };
    expect(graded(FLAW, played).status).toBe("pass");
  });

  it("cannot grade a turn that holds no decided accusation", () => {
    const turn = makeTurn({ action: { type: "accuse", player_reasoning: "Mia did it." } });
    const reported = { ...turn, response: { ...turn.response, action: "accuse", raw: { accused_character_id: "mia", cited_clue_ids: [] } } };
    expect(graded(FLAW, reported)).toMatchObject({ status: "error", reason: expect.stringMatching(/cannot read/) });
  });
});

describe("validating expect", () => {
  const base = { id: "c", blueprint: { path: "b.json" }, given: {} };
  const check = (testCase: Partial<TurnCase>) => () => validateExpect({ ...base, action: { type: "ask" }, ...testCase } as TurnCase);

  it("accepts each action's own keys, and a case without expect", () => {
    expect(check({ action: { type: "search" }, expect: { revealed_clue_id: null, input_understood: true } })).not.toThrow();
    expect(check({ expect: { revealed_clue_ids: [], used_clue_ids: ["g"] }, group: "g", ungraded: true })).not.toThrow();
    expect(check({})).not.toThrow();
  });

  it("refuses a key the action's output lacks, or an action it cannot grade", () => {
    expect(check({ expect: { revealed_clue_id: "x" } })).toThrow(/does not apply to a ask case/);
    expect(check({ action: { type: "search" }, expect: { used_clue_ids: [] } })).toThrow(/does not apply/);
    expect(check({ action: { type: "move" }, expect: { input_understood: true } })).toThrow(/not move/);
  });

  it("takes an accusation's own keys, and refuses a clue's, a bad value or a kind of reply on a win", () => {
    const accuse = (expectation: Expect) => check({ action: { type: "accuse" }, expect: expectation });
    expect(accuse({ verdict: "not_yet", reply_kind: "missing", handed: ["Ms. Hale", ["where", "alibi"]], judges: { gm_spoiler: "given_away" } })).not.toThrow();
    expect(accuse({ verdict: "win", handed: ["Toby"] })).not.toThrow();
    expect(accuse({ verdict: "win", input_understood: true })).toThrow(/does not apply to a accuse case/);
    expect(accuse({ revealed_clue_ids: [] })).toThrow(/does not apply/);
    expect(accuse({ verdict: "maybe" as "win" })).toThrow(/verdict must be one of/);
    expect(accuse({ reply_kind: "hint" as "flaw" })).toThrow(/reply_kind must be one of/);
    expect(accuse({ verdict: "lose", reply_kind: "flaw" })).toThrow(/only to a not_yet verdict/);
    expect(accuse({ handed: [] })).toThrow(/handed must list details/);
    expect(check({ expect: { verdict: "win" } })).toThrow(/does not apply to a ask case/);
  });

  it("refuses an empty expect, bad values, and a group without expect", () => {
    expect(check({ expect: {} })).toThrow(/nothing to grade/);
    expect(check({ expect: { judges: {} } })).toThrow(/nothing to grade/);
    expect(check({ expect: { revealed_clue_ids: "x" as unknown as string[] } })).toThrow(/list of clue ids/);
    expect(check({ expect: { judges: { gm_roleplay: "maybe" as "either" } } })).toThrow(/must be one of/);
    expect(check({ group: "g" })).toThrow(/only to a case with expect/);
  });
});

const RUN: RunInfo = {
  id: "2026-11-20/10-00-00-judge-turn",
  command: "judge turn",
  argv: ["cases"],
  started_at: "2026-11-20T10:00:00.000Z",
  ended_at: null,
  commit: "0123456789abcdef",
  tree_clean: true,
  bindings: {},
  judge_versions: {},
  suite: null,
  label: null,
  developer: null,
  host: null,
  parent_run: null,
  prompt_versions: null,
};

const pass: Verdict = { id: "expect", tier: "mechanical", status: "pass", details: { erred: [], use: null } };
const withheldUnseen: Verdict = { id: "expect", tier: "mechanical", status: "fail", details: { erred: ["withheld"], use: "unseen" } };
const givenAway: Verdict = { id: "expect", tier: "mechanical", status: "fail", details: { erred: ["given_away"], use: null } };

function samples(caseId: string, group: string, verdicts: Array<Verdict | null>, extra: Partial<Sample> = {}): Sample[] {
  return verdicts.map((verdict) => ({ caseId, narrator: "narrator-claude", model: "narrator-claude:haiku", group, ungraded: false, verdict, ...extra }));
}

describe("summing samples", () => {
  const all = [
    ...samples("a", "should", [pass, pass, withheldUnseen, pass, pass]),
    ...samples("b", "should", [withheldUnseen, withheldUnseen, pass, pass, pass]),
    ...samples("c", "should-not", [pass, givenAway, pass, pass, pass]),
    ...samples("bluff", "should", [givenAway, givenAway, givenAway, givenAway, givenAway], { ungraded: true }),
  ];

  it("gives each case its share and which way it erred", () => {
    const [entry] = summarizeSamples(all, 5, RUN).narrators;
    const a = entry.cases.find((item) => item.id === "a");
    expect(a).toMatchObject({ samples: 5, graded: 5, right: 4, share: 0.8, withheld: 1, unseen: 1, given_away: 0, incomplete: 0 });
    expect(entry.cases.find((item) => item.id === "bluff")).toMatchObject({ ungraded: true, right: 0, given_away: 5 });
  });

  it("sums each group over its graded cases only", () => {
    const [entry] = summarizeSamples(all, 5, RUN).narrators;
    expect(entry.groups).toEqual([
      expect.objectContaining({ group: "should", cases: 2, samples: 10, right: 7, share: 0.7, withheld: 3, unseen: 3, given_away: 0 }),
      expect.objectContaining({ group: "should-not", cases: 1, samples: 5, right: 4, share: 0.8, given_away: 1 }),
    ]);
  });

  it("records the run's commit, the narrator, model and samples", () => {
    const summary = summarizeSamples(all, 5, RUN);
    expect(summary.run).toMatchObject({ commit: "0123456789abcdef", tree_clean: true });
    expect(summary.narrators[0]).toMatchObject({ narrator: "narrator-claude", model: "narrator-claude:haiku", samples_per_case: 5 });
  });

  it("keeps each model apart", () => {
    const both = [...samples("a", "g", [pass]), ...samples("a", "g", [givenAway], { model: "narrator-claude:sonnet" })];
    expect(summarizeSamples(both, 1, RUN).narrators.map((entry) => [entry.model, entry.cases[0].share])).toEqual([
      ["narrator-claude:haiku", 1],
      ["narrator-claude:sonnet", 0],
    ]);
  });

  it("counts a sample that did not run, or could not be graded, as neither right nor wrong, and says so", () => {
    const errored: Verdict = { id: "expect", tier: "mechanical", status: "error", reason: "judge could not judge" };
    const summary = summarizeSamples(samples("a", "g", [pass, null, errored, givenAway, pass]), 5, RUN);
    expect(summary.complete).toBe(false);
    expect(summary.narrators[0].cases[0]).toMatchObject({ samples: 5, graded: 3, right: 2, incomplete: 2 });
    expect(summary.narrators[0].cases[0].share).toBeCloseTo(2 / 3);
    expect(formatSummary(summary).at(-1)).toMatch(/^INCOMPLETE: 2 of 5 samples/);
  });

  it("prints a share per case and per group", () => {
    const text = formatSummary(summarizeSamples(all, 5, RUN)).join("\n");
    expect(text).toContain("narrator-claude:haiku (narrator-claude), 5 samples per case, at 0123456789ab");
    expect(text).toMatch(/bluff\s+should \(ungraded\)\s+0\/5\s+0%/);
    expect(text).toMatch(/should\s+2\s+7\/10\s+70%/);
    expect(text).not.toContain("INCOMPLETE");
  });
});

describe("comparing a run with a baseline", () => {
  it("prints the change in share per case and per group, and what only one holds", () => {
    const baseline = summarizeSamples([...samples("a", "should", [pass, withheldUnseen]), ...samples("gone", "should", [pass, pass])], 2, RUN);
    const run = summarizeSamples(
      [...samples("a", "should", [pass, pass]), ...samples("new", "should", [pass, givenAway])],
      2,
      { ...RUN, id: "2026-11-21/10-00-00-judge-turn", commit: "fedcba9876543210" },
    );
    const text = formatComparison(baseline, run).join("\n");
    expect(text).toContain("baseline 2026-11-20/10-00-00-judge-turn at 0123456789ab; run 2026-11-21/10-00-00-judge-turn at fedcba987654");
    expect(text).toMatch(/a\s+should\s+50%\s+100%\s+\+50 pts/);
    expect(text).toMatch(/should\s+75%\s+75%\s+0/);
    expect(text).toContain("cases only in the baseline: gone");
    expect(text).toContain("cases only in the run: new");
  });

  it("pairs only the same narrator and model, and flags an incomplete side", () => {
    const baseline = summarizeSamples(samples("a", "g", [pass]), 1, RUN);
    const run = summarizeSamples(samples("a", "g", [null], { model: "narrator-claude:sonnet" }), 1, RUN);
    const text = formatComparison(baseline, run).join("\n");
    expect(text).toContain("narrator-claude:sonnet (narrator-claude): the baseline holds no result for it");
    expect(text).toContain("narrator-claude:haiku (narrator-claude): only in the baseline");
    expect(text).toContain("INCOMPLETE run");
  });
});
