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
 * A clue-graph case may name, per clue, the details its fact holds
 * (`whole_fact`): each must be in that clue's notebook line, and in the
 * narration or the player's words it answers, or the sample `withheld` it.
 *
 * A clue-graph accusation is graded on what the engine decided from the
 * narrator's report: a `verdict` or `reply_kind` other than the case expects
 * means the report `misread` the player's line. Each `handed` detail, what the
 * engine handed the reply, must be in the narration, or the sample `withheld` it.
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
import { ACCUSATION_VERDICTS, REPLY_KINDS } from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { parseGraphSearchOutput, parseGraphTalkOutput, parseSearchOutput, parseTalkConversationOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import type { Detail, Expect, JudgedDirection, TurnCase } from "./case.ts";
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
  accuse: ["verdict", "reply_kind", "handed"],
};
/** The keys every graded action but an accusation takes: an accusation reveals no clue and reads no `input_understood`. */
const CLUE_TURN_KEYS = ["input_understood", "whole_fact"];
const JUDGED: readonly JudgedDirection[] = ["withheld", "given_away", "either"];

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0);
}

function checkExpectKeys(expect: Expect, action: string, where: string): void {
  const allowed = new Set([...GRADED_KEYS[action], "judges", ...(action === "accuse" ? [] : CLUE_TURN_KEYS)]);
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
  if ("whole_fact" in expect) checkWholeFact(expect, where);
  if (action === "accuse") checkAccusation(expect, where);
}

/** A failure has a kind of reply; a win or a loss has none. */
function checkAccusation(expect: Expect, where: string): void {
  if ("verdict" in expect && !ACCUSATION_VERDICTS.includes(expect.verdict!)) {
    throw new UsageError(`${where}: expect.verdict must be one of ${ACCUSATION_VERDICTS.join(", ")}`);
  }
  if ("reply_kind" in expect) {
    if (!REPLY_KINDS.includes(expect.reply_kind!)) throw new UsageError(`${where}: expect.reply_kind must be one of ${REPLY_KINDS.join(", ")}`);
    if (expect.verdict !== undefined && expect.verdict !== "not_yet") throw new UsageError(`${where}: expect.reply_kind applies only to a not_yet verdict`);
  }
  if ("handed" in expect && (!Array.isArray(expect.handed) || expect.handed.length === 0 || !expect.handed.every(isDetail))) {
    throw new UsageError(`${where}: expect.handed must list details, each a spelling or a list of spellings`);
  }
}

function isDetail(value: unknown): value is Detail {
  const spellings = typeof value === "string" ? [value] : value;
  return Array.isArray(spellings) && spellings.length > 0 && spellings.every((one) => typeof one === "string" && one.trim() !== "");
}

/** A `whole_fact` names clues the case expects revealed, each with at least one detail. */
function checkWholeFact(expect: Expect, where: string): void {
  const entries = Object.entries(expect.whole_fact ?? {});
  if (typeof expect.whole_fact !== "object" || expect.whole_fact === null || entries.length === 0) {
    throw new UsageError(`${where}: expect.whole_fact must map clue ids to their details`);
  }
  const revealed = expect.revealed_clue_ids ?? (expect.revealed_clue_id ? [expect.revealed_clue_id] : []);
  for (const [id, details] of entries) {
    if (!revealed.includes(id)) throw new UsageError(`${where}: expect.whole_fact.${id} is not a clue the case expects revealed`);
    if (!Array.isArray(details) || details.length === 0 || !details.every(isDetail)) {
      throw new UsageError(`${where}: expect.whole_fact.${id} must list details, each a spelling or a list of spellings`);
    }
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
  /** The notebook line written for each clue, on a clue-graph turn. */
  lines: Record<string, string>;
  /** On a clue-graph accusation, what the engine decided from the report. */
  accusation?: { verdict: string; reply_kind: string | null };
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

/** A notebook as a reply lists it (`[{ id, line }]`) or as the game saves it (keyed by clue). */
function linesOf(notebook: unknown): Record<string, string> {
  if (Array.isArray(notebook)) {
    return Object.fromEntries(notebook.map(asRecord).filter((entry) => typeof entry?.id === "string" && typeof entry.line === "string").map((entry) => [entry!.id, entry!.line]));
  }
  return Object.fromEntries(Object.entries(asRecord(notebook) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * What the engine decided of a clue-graph accusation: a server saved it on the
 * event, and a CLI narrator's chain (`replay-cli.ts`) keeps it in the same shape.
 * @throws Error when the turn holds no decided accusation
 */
function accusationSays(raw: unknown): Said {
  const payload = savedPayload(raw) ?? asRecord(raw);
  const decided = asRecord(payload?.clue_graph_accusation);
  if (typeof decided?.verdict !== "string") throw new Error("the turn holds no clue-graph accusation the engine decided");
  const kind = payload?.reply_kind;
  return { revealed: [], used: [], understood: true, lines: {}, accusation: { verdict: decided.verdict, reply_kind: typeof kind === "string" ? kind : null } };
}

/** @throws Error when a CLI narrator's reply breaks the role's contract */
export function outputSays(turn: StoredTurn): Said {
  const action = turn.action.type;
  if (action === "accuse") return accusationSays(turn.response.raw);
  const payload = savedPayload(turn.response.raw);
  if (payload) {
    const single = payload.revealed_clue_id;
    return {
      revealed: action === "search" ? (typeof single === "string" && single ? [single] : []) : strings(payload.revealed_clue_ids),
      used: strings(payload.used_clue_ids),
      understood: payload.input_understood !== false,
      lines: linesOf(asRecord(payload.clue_graph)?.notebook),
    };
  }
  // A clue-graph reply carries a notebook line for each clue it brings out.
  const graph = Array.isArray(asRecord(turn.response.raw)?.notebook);
  if (action === "search") {
    const output = graph ? parseGraphSearchOutput(turn.response.raw) : parseSearchOutput(turn.response.raw);
    const lines = "notebook" in output ? linesOf(output.notebook) : {};
    return { revealed: output.revealed_clue_id ? [output.revealed_clue_id] : [], used: [], understood: output.input_understood, lines };
  }
  // A clue-graph talk reply lists the gates it opened and the questions it answered.
  if (Array.isArray(asRecord(turn.response.raw)?.opened)) {
    const output = parseGraphTalkOutput(turn.response.raw);
    return { revealed: [...output.opened, ...output.answered], used: [], understood: output.input_understood, lines: linesOf(output.notebook) };
  }
  const output = parseTalkConversationOutput(turn.response.raw);
  return { revealed: output.revealed_clue_ids, used: output.used_clue_ids, understood: output.input_understood, lines: {} };
}

/** One detail a whole-fact case found missing, and where. */
export interface MissingDetail {
  clue: string;
  detail: string;
  from: "narration" | "notebook";
}

/** Text compared for a detail: lower case, straight quotes, single spaces. */
function plain(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ");
}

/** Whether one of a detail's spellings stands in the text as whole words. */
function carries(text: string, detail: Detail): boolean {
  const spellings = typeof detail === "string" ? [detail] : detail;
  return spellings.some((spelling) => {
    const escaped = plain(spelling.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(plain(text));
  });
}

/**
 * Each detail of each whole-fact clue the turn revealed that its narration or
 * its notebook line leaves out. The narration answers the player's words, so a
 * detail they just named may be referred back to ("they're mine"); the line
 * stands alone and names every one. A clue not revealed is the id check's to grade.
 */
function missingDetails(expect: Expect, said: Said, narration: string): MissingDetail[] {
  const missing: MissingDetail[] = [];
  for (const [clue, details] of Object.entries(expect.whole_fact ?? {})) {
    if (!said.revealed.includes(clue)) continue;
    for (const detail of details) {
      const name = typeof detail === "string" ? detail : detail[0];
      if (!carries(narration, detail)) missing.push({ clue, detail: name, from: "narration" });
      if (!carries(said.lines[clue] ?? "", detail)) missing.push({ clue, detail: name, from: "notebook" });
    }
  }
  return missing;
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

/** What comes out with a clue besides itself: on a clue graph, the tells seen with a statement. */
export type ComesWith = (id: string) => string[];

/** The ids with what comes out with each, as the game folds a reveal. */
function withRiders(ids: string[], comesWith: ComesWith): string[] {
  return [...new Set(ids.flatMap((id) => [id, ...comesWith(id)]))];
}

function idChecks(expect: Expect, said: Said, comesWith: ComesWith): IdCheck[] {
  const checks: IdCheck[] = [];
  if ("revealed_clue_id" in expect) checks.push(compareIds("revealed_clue_id", expect.revealed_clue_id ? [expect.revealed_clue_id] : [], said.revealed));
  if (expect.revealed_clue_ids) {
    checks.push(compareIds("revealed_clue_ids", withRiders(expect.revealed_clue_ids, comesWith), withRiders(said.revealed, comesWith)));
  }
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

/** How a decided accusation compares with the case: the verdict and reply kind it expects, each against the engine's. */
interface AccusationCheck {
  verdict: { expected: string; actual: string } | null;
  reply_kind: { expected: string; actual: string | null } | null;
}

function accusationCheck(expect: Expect, said: Said): AccusationCheck | null {
  if (!said.accusation) return null;
  return {
    verdict: expect.verdict === undefined ? null : { expected: expect.verdict, actual: said.accusation.verdict },
    reply_kind: expect.reply_kind === undefined ? null : { expected: expect.reply_kind, actual: said.accusation.reply_kind },
  };
}

/** The `handed` details the narration leaves out, each by its first spelling. */
function missingHanded(expect: Expect, narration: string): string[] {
  return (expect.handed ?? []).filter((detail) => !carries(narration, detail)).map((detail) => (typeof detail === "string" ? detail : detail[0]));
}

/** An accusation errs as `misread` when the engine decided otherwise, and `withheld` a handed detail the reply left out. */
function accusationErred(accusation: AccusationCheck | null, handed: string[]): Direction[] {
  const decidedOtherwise = [accusation?.verdict, accusation?.reply_kind].some((check) => check && check.expected !== check.actual);
  return [...(handed.length > 0 ? ["withheld" as const] : []), ...(decidedOtherwise ? ["misread" as const] : [])];
}

function erredWays(expect: Expect, checks: IdCheck[], said: Said, statuses: Record<string, string>, missing: MissingDetail[]): Direction[] {
  const erred = new Set<Direction>();
  if (missing.length > 0) erred.add("withheld");
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

/**
 * The `expect` verdict for one sample, read from its turn and the verdicts its
 * judges gave. `comesWith` names what comes out with a clue, so a tell the game
 * gives with its statement counts whether or not the reply listed it.
 */
export function gradeExpect(expect: Expect, turn: StoredTurn, verdicts: readonly Verdict[], comesWith: ComesWith = () => []): Verdict {
  let said: Said;
  try {
    said = outputSays(turn);
  } catch (error) {
    return { id: EXPECT_VERDICT, tier: "mechanical", status: "error", reason: `cannot read the narrator's output: ${(error as Error).message}` };
  }
  const { statuses, ungradable } = judgeStatuses(expect, verdicts);
  if (ungradable) return { id: EXPECT_VERDICT, tier: "mechanical", status: "error", reason: ungradable };
  const checks = idChecks(expect, said, comesWith);
  const exchange = [turn.action.player_input, turn.action.search_query, turn.response.narration_text].filter(Boolean).join("\n");
  const missing = missingDetails(expect, said, exchange);
  const accusation = accusationCheck(expect, said);
  // The reply words what the engine handed it, so only the narration counts, never the player's line.
  const handed = missingHanded(expect, turn.response.narration_text ?? "");
  const ways = new Set([...erredWays(expect, checks, said, statuses, missing), ...accusationErred(accusation, handed)]);
  const erred = DIRECTIONS.filter((direction) => ways.has(direction));
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
      ...(expect.whole_fact ? { missing_details: missing } : {}),
      ...(accusation ? { accusation } : {}),
      ...(expect.handed ? { missing_handed: handed } : {}),
    },
  };
}
