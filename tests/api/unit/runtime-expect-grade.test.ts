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
  return { ...turn, response: { ...turn.response, action: "search", raw: { narration: "You look.", ...raw } } };
}

function askTurn(raw: Record<string, unknown>): StoredTurn {
  const turn = makeTurn();
  return { ...turn, response: { ...turn.response, raw: { narration: "Alice shrugs.", ...raw } } };
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
    expect(graded({ revealed_clue_ids: ["a", "b"] }, askTurn({ revealed_clue_ids: ["b", "a"] })).status).toBe("pass");
    expect(graded({ revealed_clue_ids: ["a", "b"] }, askTurn({ revealed_clue_ids: ["a"] })).erred).toEqual(["withheld"]);
    expect(graded({ revealed_clue_ids: ["a"] }, askTurn({ revealed_clue_ids: ["a", "b"] })).erred).toEqual(["given_away"]);
  });

  it("holds an empty expectation to nothing given", () => {
    expect(graded({ revealed_clue_ids: [] }, askTurn({ revealed_clue_ids: [] })).status).toBe("pass");
    expect(graded({ revealed_clue_ids: [] }, askTurn({ revealed_clue_ids: ["a"] })).erred).toEqual(["given_away"]);
  });

  it("grades used_clue_ids in both directions", () => {
    expect(graded({ used_clue_ids: ["gate"] }, askTurn({ used_clue_ids: ["gate"] })).status).toBe("pass");
    expect(graded({ used_clue_ids: ["gate"] }, askTurn({ used_clue_ids: [] })).erred).toEqual(["withheld"]);
    expect(graded({ used_clue_ids: [] }, askTurn({ used_clue_ids: ["gate"] })).erred).toEqual(["given_away"]);
  });

  it("grades input_understood both ways", () => {
    expect(graded({ input_understood: true }, askTurn({ input_understood: false })).erred).toEqual(["misread"]);
    expect(graded({ input_understood: false }, askTurn({ input_understood: true })).erred).toEqual(["misread"]);
    expect(graded({ input_understood: true }, askTurn({})).status).toBe("pass");
  });

  it("says a withheld clue went unseen when the use is missing", () => {
    const turn = askTurn({ revealed_clue_ids: [], used_clue_ids: [] });
    expect(graded({ revealed_clue_ids: ["admission"], used_clue_ids: ["gate"] }, turn)).toMatchObject({ erred: ["withheld"], use: "unseen" });
  });

  it("says a withheld clue was seen and refused when the use is there", () => {
    const turn = askTurn({ revealed_clue_ids: [], used_clue_ids: ["gate"] });
    expect(graded({ revealed_clue_ids: ["admission"], used_clue_ids: ["gate"] }, turn)).toMatchObject({ erred: ["withheld"], use: "refused" });
  });

  it("says nothing of the use when the case names none, or nothing was withheld", () => {
    expect(graded({ revealed_clue_ids: ["admission"] }, askTurn({ revealed_clue_ids: [], used_clue_ids: ["gate"] })).use).toBeNull();
    expect(graded({ revealed_clue_ids: [], used_clue_ids: ["gate"] }, askTurn({ revealed_clue_ids: ["x"], used_clue_ids: ["gate"] })).use).toBeNull();
  });

  it("reads a server's saved event rather than a role reply", () => {
    const turn = askTurn({});
    const served = {
      ...turn,
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

describe("a judge-graded case", () => {
  const roleplay = (status: Verdict["status"]): Verdict => ({ id: "gm_roleplay", tier: "judge", status });

  it("is right when the judge passes, and errs the way the case says when it fails", () => {
    const expectation: Expect = { used_clue_ids: ["gate"], judges: { gm_roleplay: "withheld" } };
    const turn = askTurn({ used_clue_ids: ["gate"] });
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

  it("refuses an empty expect, bad values, and a group without expect", () => {
    expect(check({ expect: {} })).toThrow(/nothing to grade/);
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
