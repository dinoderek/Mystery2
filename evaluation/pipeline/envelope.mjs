// Combines a dimension's analyzer and judge results into its overall status.
// The trace harness shares it until it moves onto the evaluation core.

export function combineDimension({ id, analyzer, judge, error }) {
  if (error) {
    return { id, analyzer, judge, overall: "error", error };
  }
  const sub = [];
  if (analyzer) sub.push(analyzer.status);
  if (judge) sub.push(judge.status);
  if (sub.length === 0) {
    return {
      id,
      analyzer,
      judge,
      overall: "error",
      error: {
        stage: "compose",
        message: "Dimension produced neither analyzer nor judge result.",
      },
    };
  }
  const considered = sub.filter((s) => s !== "skipped");
  if (considered.length === 0) {
    return { id, analyzer, judge, overall: "skipped" };
  }
  const overall = considered.every((s) => s === "pass") ? "pass" : "fail";
  return { id, analyzer, judge, overall };
}
