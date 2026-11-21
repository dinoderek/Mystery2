/**
 * Grading a case's `expect` by code: what the narrator's structured output says
 * against what the case expects, with no judge call. A case may also name turn
 * judges whose fail makes a sample wrong (`expect.judges`); they run like any
 * other judge and are read here.
 *
 * A sample is right when nothing erred. A wrong one says which way:
 *
 * - `withheld`: an expected clue or use is missing;
 * - `given_away`: a clue or use that was not expected is there;
 * - `misread`: `input_understood` is not what was expected;
 * - `judged`: a judge failed and the case does not say which way that errs.
 *
 * A talk sample that withheld, on a case naming the uses it expects, says
 * whether the use went `unseen` (one is missing from `used_clue_ids`) or was
 * `refused` (every one is there, but the clue or part was not given).
 *
 * A CLI narrator is graded on its reply as the engine's role contract parses
 * it, before the game's own checks (which clues it admits, which uses it
 * keeps); a server narrator on the event the game saved. A reply the contract
 * refuses, or a named judge that could not judge, cannot be graded: the sample
 * is an error, counted neither right nor wrong.
 */

import { UsageError } from "../../core/errors.ts";
import type { Verdict } from "../../core/result.ts";
import { parseGraphTalkOutput, parseSearchOutput, parseTalkConversationOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import type { Expect, JudgedDirection, TurnCase } from "./case.ts";
import type { StoredTurn } from "./turn.ts";

/** The verdict id the grade is stored under, beside the judges' verdicts. */
export const EXPECT_VERDICT = "expect";

export const DIRECTIONS = ["withheld", "given_away", "misread", "judged"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type UseOutcome = "unseen" | "refused";

/** The actions an `expect` can grade, and the clue keys each one's output has. */
const GRADED_KEYS: Record<string, readonly string[]> = {
  search: ["revealed_clue_id"],
  ask: ["revealed_clue_ids", "used_clue_ids"],
};
const JUDGED: readonly JudgedDirection[] = ["withheld", "given_away", "either"];

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0);
}

function checkExpectKeys(expect: Expect, action: string, where: string): void {
  const allowed = new Set([...GRADED_KEYS[action], "input_understood", "judges"]);
  const keys = Object.keys(expect);
  const grades = keys.some((key) => key !== "judges") || Object.keys(expect.judges ?? {}).length > 0;
  if (!grades) throw new UsageError(`${where}: expect names nothing to grade`);
  for (const key of keys) {
    if (!allowed.has(key)) throw new UsageError(`${where}: expect.${key} does not apply to a ${action} case`);
  }
  if ("revealed_clue_id" in expect && expect.revealed_clue_id !== null && (typeof expect.revealed_clue_id !== "string" || expect.revealed_clue_id === "")) {
    throw new UsageError(`${where}: expect.revealed_clue_id must be a clue id or null`);
  }
  for (const key of ["revealed_clue_ids", "used_clue_ids"] as const) {
    if (key in expect && !isIdList(expect[key])) throw new UsageError(`${where}: expect.${key} must be a list of clue ids`);
  }
  if ("input_understood" in expect && typeof expect.input_understood !== "boolean") {
    throw new UsageError(`${where}: expect.input_understood must be true or false`);
  }
  for (const [id, direction] of Object.entries(expect.judges ?? {})) {
    if (!JUDGED.includes(direction)) throw new UsageError(`${where}: expect.judges.${id} must be one of ${JUDGED.join(", ")}`);
  }
}

/** Refuses an `expect`, `group` or `ungraded` the case cannot be graded on. */
export function validateExpect(testCase: TurnCase): void {
  const where = `case ${testCase.id}`;
  if (testCase.expect === undefined) {
    if (testCase.group !== undefined || testCase.ungraded !== undefined) {
      throw new UsageError(`${where}: group and ungraded apply only to a case with expect`);
    }
    return;
  }
  const action = testCase.action.type;
  if (!(action in GRADED_KEYS)) {
    throw new UsageError(`${where}: expect grades ${Object.keys(GRADED_KEYS).join(" and ")} cases, not ${action}`);
  }
  if (typeof testCase.expect !== "object" || testCase.expect === null) throw new UsageError(`${where}: expect must be an object`);
  checkExpectKeys(testCase.expect, action, where);
  if (testCase.group !== undefined && (typeof testCase.group !== "string" || testCase.group === "")) {
    throw new UsageError(`${where}: group must be a non-empty string`);
  }
  if (testCase.ungraded !== undefined && typeof testCase.ungraded !== "boolean") {
    throw new UsageError(`${where}: ungraded must be true or false`);
  }
}

/** The judges a case's `expect` needs run, which every sample runs whatever `--judges` says. */
export function expectJudges(testCase: TurnCase): string[] {
  return Object.keys(testCase.expect?.judges ?? {});
}

/** What the graded fields say, as the game reads them. */
interface Said {
  revealed: string[];
  used: string[];
  understood: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/** A server's answer holds the saved event, whose payload the engine already parsed and checked. */
function savedPayload(raw: unknown): Record<string, unknown> | null {
  const answer = asRecord(raw);
  if (answer?.kind !== "turn" || !Array.isArray(answer.events)) return null;
  return asRecord(asRecord(answer.events[0])?.payload);
}

/** @throws Error when a CLI narrator's reply breaks the role's contract */
export function outputSays(turn: StoredTurn): Said {
  const action = turn.action.type;
  const payload = savedPayload(turn.response.raw);
  if (payload) {
    const single = payload.revealed_clue_id;
    return {
      revealed: action === "search" ? (typeof single === "string" && single ? [single] : []) : strings(payload.revealed_clue_ids),
      used: strings(payload.used_clue_ids),
      understood: payload.input_understood !== false,
    };
  }
  if (action === "search") {
    const output = parseSearchOutput(turn.response.raw);
    return { revealed: output.revealed_clue_id ? [output.revealed_clue_id] : [], used: [], understood: output.input_understood };
  }
  // A clue-graph talk reply lists the gates it opened and the questions it answered.
  if (Array.isArray(asRecord(turn.response.raw)?.opened)) {
    const output = parseGraphTalkOutput(turn.response.raw);
    return { revealed: [...output.opened, ...output.answered], used: [], understood: output.input_understood };
  }
  const output = parseTalkConversationOutput(turn.response.raw);
  return { revealed: output.revealed_clue_ids, used: output.used_clue_ids, understood: output.input_understood };
}

interface IdCheck {
  field: string;
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
}

function compareIds(field: string, expected: string[], actual: string[]): IdCheck {
  return {
    field,
    expected,
    actual,
    missing: expected.filter((id) => !actual.includes(id)),
    extra: actual.filter((id) => !expected.includes(id)),
  };
}

function idChecks(expect: Expect, said: Said): IdCheck[] {
  const checks: IdCheck[] = [];
  if ("revealed_clue_id" in expect) checks.push(compareIds("revealed_clue_id", expect.revealed_clue_id ? [expect.revealed_clue_id] : [], said.revealed));
  if (expect.revealed_clue_ids) checks.push(compareIds("revealed_clue_ids", expect.revealed_clue_ids, said.revealed));
  if (expect.used_clue_ids) checks.push(compareIds("used_clue_ids", expect.used_clue_ids, said.used));
  return checks;
}

/** Each named judge's status, or why the sample cannot be graded on it. */
function judgeStatuses(expect: Expect, verdicts: readonly Verdict[]): { statuses: Record<string, string>; ungradable: string | null } {
  const statuses: Record<string, string> = {};
  for (const id of Object.keys(expect.judges ?? {})) {
    const verdict = verdicts.find((entry) => entry.id === id);
    statuses[id] = verdict?.status ?? "missing";
    if (verdict?.status !== "pass" && verdict?.status !== "fail") {
      return { statuses, ungradable: `judge ${id} did not judge (${verdict ? `${verdict.status}: ${verdict.reason ?? ""}` : "no verdict"})` };
    }
  }
  return { statuses, ungradable: null };
}

function erredWays(expect: Expect, checks: IdCheck[], said: Said, statuses: Record<string, string>): Direction[] {
  const erred = new Set<Direction>();
  for (const check of checks) {
    if (check.missing.length > 0) erred.add("withheld");
    if (check.extra.length > 0) erred.add("given_away");
  }
  if (expect.input_understood !== undefined && expect.input_understood !== said.understood) erred.add("misread");
  for (const [id, direction] of Object.entries(expect.judges ?? {})) {
    if (statuses[id] === "fail") erred.add(direction === "either" ? "judged" : direction);
  }
  return DIRECTIONS.filter((direction) => erred.has(direction));
}

function useOutcome(expect: Expect, erred: Direction[], checks: IdCheck[]): UseOutcome | null {
  if (!erred.includes("withheld") || !expect.used_clue_ids?.length) return null;
  const used = checks.find((check) => check.field === "used_clue_ids");
  return used && used.missing.length > 0 ? "unseen" : "refused";
}

/** The `expect` verdict for one sample, read from its turn and the verdicts its judges gave. */
export function gradeExpect(expect: Expect, turn: StoredTurn, verdicts: readonly Verdict[]): Verdict {
  let said: Said;
  try {
    said = outputSays(turn);
  } catch (error) {
    return { id: EXPECT_VERDICT, tier: "mechanical", status: "error", reason: `cannot read the narrator's output: ${(error as Error).message}` };
  }
  const { statuses, ungradable } = judgeStatuses(expect, verdicts);
  if (ungradable) return { id: EXPECT_VERDICT, tier: "mechanical", status: "error", reason: ungradable };
  const checks = idChecks(expect, said);
  const erred = erredWays(expect, checks, said, statuses);
  return {
    id: EXPECT_VERDICT,
    tier: "mechanical",
    status: erred.length === 0 ? "pass" : "fail",
    details: {
      erred,
      use: useOutcome(expect, erred, checks),
      checks,
      input_understood: expect.input_understood === undefined ? null : { expected: expect.input_understood, actual: said.understood },
      judges: statuses,
    },
  };
}
