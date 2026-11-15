/**
 * A suite's thresholds, checked against the score of its own results.
 *
 * A threshold names a judge (every one of its models, or `<judge>@<model>`
 * for one) or none (every judge), and a kind or none (each of the judge's
 * kinds). Each share is the point share `score` reports; a share with nothing
 * to share (no real fault judged, no unit reported) is unmeasured, and an
 * unmeasured share does not meet its threshold.
 */

import type { MemberScore, ScoreReport } from "../lib/truth/score.ts";
import type { Share } from "../lib/truth/wilson.ts";
import type { Threshold } from "./file.ts";

export interface ThresholdCheck {
  threshold: Threshold;
  /** One line per member and measure, each saying whether it met. */
  lines: string[];
  met: boolean;
}

function members(report: ScoreReport, judge: string | undefined): MemberScore[] {
  const all = report.sides.flatMap((side) => side.members);
  if (judge === undefined) return all;
  const [id, model] = judge.split("@");
  return all.filter((member) => member.judge === id && (model === undefined || member.model === model));
}

function shareLine(label: string, value: Share, bar: number): { line: string; met: boolean } {
  if (value.share === null) return { line: `${label} unmeasured (${value.hits}/${value.of}), needs ${bar}: not met`, met: false };
  const met = value.share >= bar;
  return { line: `${label} ${value.share.toFixed(2)} (${value.hits}/${value.of}), needs ${bar}: ${met ? "met" : "not met"}`, met };
}

function checkMember(member: MemberScore, threshold: Threshold): Array<{ line: string; met: boolean }> {
  const checks: Array<{ line: string; met: boolean }> = [];
  if (threshold.max_errors !== undefined) {
    const met = member.not_judged <= threshold.max_errors;
    checks.push({ line: `${member.id}: ${member.not_judged} error(s), at most ${threshold.max_errors}: ${met ? "met" : "not met"}`, met });
  }
  for (const kind of member.kinds.filter((candidate) => threshold.kind === undefined || candidate.kind === threshold.kind)) {
    if (threshold.min_found_of_real !== undefined) {
      checks.push(shareLine(`${member.id} ${kind.kind}: found of real`, kind.shares.found_of_real, threshold.min_found_of_real));
    }
    if (threshold.min_real_of_reported !== undefined) {
      checks.push(shareLine(`${member.id} ${kind.kind}: real of reported`, kind.shares.real_of_reported, threshold.min_real_of_reported));
    }
  }
  return checks;
}

/** Checks each threshold against the report; a threshold no member answers to is not met. */
export function checkThresholds(thresholds: readonly Threshold[], report: ScoreReport): ThresholdCheck[] {
  return thresholds.map((threshold) => {
    const checks = members(report, threshold.judge).flatMap((member) => checkMember(member, threshold));
    if (checks.length === 0) {
      return { threshold, lines: [`${threshold.judge ?? "every judge"}: nothing was scored to check: not met`], met: false };
    }
    return { threshold, lines: checks.map((check) => check.line), met: checks.every((check) => check.met) };
  });
}
