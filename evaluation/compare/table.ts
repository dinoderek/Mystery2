/**
 * The text `./dev eval compare` prints: per side, a row per judge and kind with
 * the outcome, each run's delay and usage per judge, the differences, and what
 * only one run judged. The JSON report holds the same numbers unrounded.
 */

import type { CompareReport, KindComparison, MemberComparison, Outcome, SideComparison } from "../lib/truth/compare.ts";
import { SIGNIFICANCE } from "../lib/truth/compare.ts";
import { delay, table, usage } from "../score/table.ts";

/** Past this many lines a listing stops, and says where the rest is. */
export const LISTED = 40;

const OUTCOMES: Record<Outcome, string> = {
  same: "same",
  within_variation: "within variation",
  not_shown: "not shown",
  differs: "differs",
  unmeasured: "variation unmeasured",
  no_paired_units: "no paired units",
};

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function agreement(value: KindComparison["agreement"]["a"]): string {
  return value.share === null ? "unmeasured" : `${value.share.toFixed(2)} of ${value.units}`;
}

function result(kind: KindComparison): string {
  const base = OUTCOMES[kind.outcome];
  if (kind.outcome !== "differs") return base;
  return kind.firm.a_only > kind.firm.b_only ? `${base}: A catches more` : `${base}: B catches more`;
}

function chance(p: number | null): string {
  if (p === null) return "-";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

function kindRows(member: MemberComparison): string[][] {
  return member.kinds.map((kind, index) => [
    index === 0 ? member.id : "",
    kind.kind,
    String(kind.paired),
    `${kind.catches.a}/${kind.catches.b}`,
    `${kind.differing.a_only}/${kind.differing.b_only}`,
    `${kind.firm.a_only}/${kind.firm.b_only}`,
    String(kind.within_variation),
    String(kind.unmeasured),
    agreement(kind.agreement.a),
    agreement(kind.agreement.b),
    chance(kind.p),
    result(kind),
  ]);
}

function chargeRows(members: readonly MemberComparison[]): string[][] {
  return members.map((member) => [member.id, member.a.model, member.b.model, delay(member.a.delay_ms), delay(member.b.delay_ms), usage(member.a.usage_usd), usage(member.b.usage_usd)]);
}

function differenceLines(members: readonly MemberComparison[]): string[] {
  const lines: string[] = [];
  for (const member of members) {
    for (const kind of member.kinds) {
      for (const difference of kind.differences) {
        const votes = (own: { catches: number; of: number }) => `${own.catches}/${own.of}`;
        const call = difference.call === "within_variation" ? "within variation" : difference.call;
        lines.push(
          `${member.id} ${kind.kind}, ${difference.unit}: ${difference.catching === "a" ? "A" : "B"} catches (A ${votes(difference.a)}, B ${votes(difference.b)}), ${call}, truth ${difference.truth}`,
        );
      }
    }
  }
  return lines;
}

function onlyLines(side: SideComparison, run: "a" | "b"): string[] {
  const lines = side.only_in[run].map((id) => `${run.toUpperCase()} only, judge ${id}: not in the other run`);
  for (const member of side.members) {
    for (const kind of member.kinds) {
      for (const unit of kind.only_in[run]) lines.push(`${run.toUpperCase()} only: ${member.id} ${kind.kind}, ${unit}`);
    }
  }
  return lines;
}

function capped(lines: readonly string[]): string[] {
  if (lines.length <= LISTED) return [...lines];
  return [...lines.slice(0, LISTED), `... and ${lines.length - LISTED} more, all in the JSON report`];
}

function sideSection(side: SideComparison): string[] {
  const out = [`${side.side === "blueprint" ? "Blueprint" : "Game"} side: ${counted(side.members.length, "judge")} in both runs`, ""];
  if (side.members.length > 0) {
    out.push(
      ...table(
        ["Judge", "Kind", "Paired", "Catches A/B", "Differ A/B only", "Firm A/B", "Within variation", "Unmeasured", "Agreement A", "Agreement B", "Chance", "Result"],
        side.members.flatMap(kindRows),
      ),
      "",
      "Delay and usage, over the stored subjects both runs judged the judge on",
      ...table(["Judge", "Model A", "Model B", "Delay A", "Delay B", "Usage A", "Usage B"], chargeRows(side.members)),
    );
  }
  const differences = differenceLines(side.members);
  if (differences.length > 0) out.push("", "Differences", ...capped(differences));
  const only = [...onlyLines(side, "a"), ...onlyLines(side, "b")];
  if (only.length > 0) out.push("", "Left out, judged by one run only", ...capped(only));
  return out;
}

function unmeasuredNote(report: CompareReport): string[] {
  const unmeasured = report.sides.some((side) => side.members.some((member) => member.kinds.some((kind) => kind.outcome === "unmeasured")));
  return unmeasured
    ? ["", "Variation unmeasured: a run with one judging sample per unit shows no variation of its own, so its differences are listed and none is called."]
    : [];
}

/** What was compared, as the report names it. */
export interface CompareInputs {
  truth: string;
  a: string;
  b: string;
  /** The one model kept from a run, or null when all its verdicts were. */
  model_a: string | null;
  model_b: string | null;
}

function run(file: string, model: string | null): string {
  return model === null ? file : `${file} (${model} only)`;
}

/** The whole report as text. */
export function formatCompare(report: CompareReport, inputs: CompareInputs): string {
  const lines = [
    `Compared A ${run(inputs.a, inputs.model_a)} with B ${run(inputs.b, inputs.model_b)}, against the truth set at ${inputs.truth}.`,
    "Paired on the units both runs judged. A run catches a unit when most of its judging samples do; a tie is not a catch.",
    `A difference is firm when each run's own samples are unanimous on it; otherwise it is within variation. The test: ${report.rules.test}; ${SIGNIFICANCE} or less is "differs".`,
  ];
  if (report.sides.length === 0) lines.push("", "No verdicts to compare.");
  for (const side of report.sides) lines.push("", ...sideSection(side));
  lines.push(...unmeasuredNote(report));
  return lines.join("\n");
}
