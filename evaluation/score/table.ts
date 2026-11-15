/**
 * The text tables `./dev eval score` prints: per side, a row per judge and
 * kind, then every subset, then the smallest that meets the bar. The JSON
 * report holds the same numbers unrounded.
 */

import type { MemberScore, ScoreReport, SideScore, SubsetScore } from "../lib/truth/score.ts";
import type { Share } from "../lib/truth/wilson.ts";

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)));
  return [header, ...rows].map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join("  ")
      .trimEnd(),
  );
}

function share(value: Share): string {
  if (value.share === null || value.low === null || value.high === null) return `${value.hits}/${value.of}  -`;
  return `${value.hits}/${value.of}  ${value.share.toFixed(2)} [${value.low.toFixed(2)}, ${value.high.toFixed(2)}]`;
}

export function delay(ms: number | null): string {
  return ms === null ? "unknown" : `${(ms / 1000).toFixed(1)}s`;
}

export function usage(usd: number | null): string {
  return usd === null ? "unknown" : `$${usd.toFixed(4)}`;
}

function memberRows(member: MemberScore): string[][] {
  return member.kinds.map((kind, index) => [
    index === 0 ? member.id : "",
    index === 0 ? member.model : "",
    kind.kind,
    `${kind.units.fault}/${kind.units.clean}/${kind.units.unknown}`,
    share(kind.shares.real_of_reported),
    share(kind.shares.found_of_real),
    String(kind.shares.unknown_reported),
    kind.agreement.share === null ? "unmeasured" : `${kind.agreement.share.toFixed(2)} of ${kind.agreement.units}`,
    `${kind.major_only.real_of_reported.hits}/${kind.major_only.real_of_reported.of}, ${kind.major_only.found_of_real.hits}/${kind.major_only.found_of_real.of}`,
    index === 0 ? delay(member.delay_ms) : "",
    index === 0 ? usage(member.usage_usd) : "",
  ]);
}

function memberNotes(members: readonly MemberScore[]): string[] {
  const notes: string[] = [];
  for (const member of members) {
    if (member.not_judged > 0) notes.push(`${member.id}: ${member.not_judged} of ${counted(member.verdicts, "verdict")} did not judge (error or skipped) and do not vote.`);
    if (member.findings_off_turn > 0) notes.push(`${member.id}: ${counted(member.findings_off_turn, "finding")} pointed at no turn it judged and caught nothing.`);
  }
  return notes;
}

function members(side: SideScore): string[] {
  return [
    ...table(
      ["Judge", "Model", "Kind", "Units f/c/u", "Real of reported", "Found of real", "Unknown reported", "Agreement", "Major only", "Delay", "Usage"],
      side.members.flatMap(memberRows),
    ),
    ...memberNotes(side.members),
  ];
}

function subsetName(subset: SubsetScore): string {
  return subset.members.length === 0 ? "(none)" : subset.members.join(" + ");
}

function subsets(side: SideScore): string[] {
  return table(
    ["Subset", "Found", "False reports", "Delay", "Usage", "Meets the bar"],
    side.subsets.map((subset) => [
      subsetName(subset),
      `${subset.found}/${side.faults}`,
      String(subset.false_reports),
      delay(subset.delay_ms),
      usage(subset.usage_usd),
      subset.meets_bar ? "yes" : "",
    ]),
  );
}

function smallest(side: SideScore, bar: string): string {
  const best = side.smallest;
  if (best === null) return `No subset ${bar}.`;
  return (
    `Smallest that ${bar}: ${subsetName(best)}. Found ${best.found} of ${counted(side.faults, "real fault")} ` +
    `(the full battery ${side.full_found}), ${counted(best.false_reports, "false report")}, delay ${delay(best.delay_ms)}, usage ${usage(best.usage_usd)}.`
  );
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sideSection(side: SideScore, bar: string): string[] {
  return [
    `${side.side === "blueprint" ? "Blueprint" : "Game"} side: ${counted(side.members.length, "judge")}, ${counted(side.faults, "real fault")} judged`,
    "",
    ...members(side),
    "",
    `Every subset (${side.subsets.length})`,
    ...subsets(side),
    "",
    smallest(side, bar),
  ];
}

/** The whole report as text. */
export function formatScore(report: ScoreReport, inputs: { truth: string; results: readonly string[] }): string {
  const lines = [
    `Scored ${inputs.results.join(", ")} against the truth set at ${inputs.truth}.`,
    "A finding of either severity is a report; Major only gives real/reported and found/real counting only major findings.",
    "A judge catches a unit when most of its judging samples do; a tie is not a catch. Units of unknown truth are in neither share.",
  ];
  if (report.sides.length === 0) lines.push("", "No verdicts to score.");
  for (const side of report.sides) lines.push("", ...sideSection(side, report.rules.bar.text));
  return lines.join("\n");
}
