// Judge registry.
//
// A Judge scores a stored interaction's single response. Every judge exposes:
//   id: string
//   judge(interaction, { config }) -> { id, status, score, details, parts }
// where status is "pass" | "fail" | "error".

import * as flesch from "./flesch.mjs";

const REGISTRY = new Map([[flesch.id, flesch]]);

export function getJudge(judgeId) {
  const judge = REGISTRY.get(judgeId);
  if (!judge) {
    throw new Error(
      `Unknown judge "${judgeId}". Known: ${[...REGISTRY.keys()].join(", ")}`,
    );
  }
  return judge;
}

/** Run a set of judges over an interaction, returning their result objects. */
export function runJudges(judgeIds, interaction, judgeConfig = {}) {
  return judgeIds.map((judgeId) => {
    const judge = getJudge(judgeId);
    try {
      return judge.judge(interaction, { config: judgeConfig[judgeId] ?? {} });
    } catch (err) {
      return {
        id: judgeId,
        status: "error",
        score: null,
        details: { error: err instanceof Error ? err.message : String(err) },
        parts: [],
      };
    }
  });
}
