// Judge registry.
//
// A Judge scores a stored interaction's single response. Every judge exposes:
//   id: string
//   judge(interaction, { config }) -> { id, status, score, details, parts }
// where status is "pass" | "fail" | "error". judge() may be sync (flesch) or
// async (age_appropriate spawns a judge-model CLI call) — the runner awaits
// either.

import * as flesch from "./flesch.mjs";
import * as ageAppropriate from "./age-appropriate.mjs";
import { adherenceJudges } from "./adherence.mjs";

// The gm_* judges are the shared game-master adherence battery
// (evaluation/judges/): the same briefs and schemas the trace pipeline runs as
// dimensions, bound here to a single interaction. Each is one judge-model call,
// so they are opt-in per case rather than defaults.
const REGISTRY = new Map([
  [flesch.id, flesch],
  [ageAppropriate.id, ageAppropriate],
  ...adherenceJudges.map((judge) => [judge.id, judge]),
]);

/** Every judge id this harness can run. */
export function judgeIds() {
  return [...REGISTRY.keys()];
}

export function getJudge(judgeId) {
  const judge = REGISTRY.get(judgeId);
  if (!judge) {
    throw new Error(
      `Unknown judge "${judgeId}". Known: ${[...REGISTRY.keys()].join(", ")}`,
    );
  }
  return judge;
}

/**
 * Run a set of judges over an interaction, returning their result objects in
 * the same order as judgeIds. Judges are independent (each reads the same
 * frozen interaction), so they run concurrently; a judge that throws becomes
 * an error result without affecting the others.
 */
export async function runJudges(judgeIds, interaction, judgeConfig = {}) {
  return Promise.all(
    judgeIds.map(async (judgeId) => {
      try {
        const judge = getJudge(judgeId);
        return await judge.judge(interaction, { config: judgeConfig[judgeId] ?? {} });
      } catch (err) {
        return {
          id: judgeId,
          status: "error",
          score: null,
          details: { error: err instanceof Error ? err.message : String(err) },
          parts: [],
        };
      }
    }),
  );
}
