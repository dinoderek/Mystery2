// Deterministic analyzer for the `clue_graph` dimension.
//
// Builds the clue discovery graph and fails on the objective, code-decidable
// faults: unknown / self prerequisite references, cycles, and a solution that is
// locked behind unreachable clues. The subjective "is the gating fun and fair?"
// call is left to the judge half of the dimension.

import { analyzeClueGraph } from "../lib/clue-graph.mjs";

export function analyze({ blueprint }) {
  const result = analyzeClueGraph(blueprint);

  const problems = [];
  if (result.unknown_requires.length > 0) {
    problems.push(`${result.unknown_requires.length} requires reference unknown clues`);
  }
  if (result.self_references.length > 0) {
    problems.push(`${result.self_references.length} clues require themselves`);
  }
  if (!result.acyclic) {
    problems.push(`${result.cycles.length} dependency cycle(s)`);
  }
  if (result.solution_locked) {
    problems.push(`${result.locked_solution_clues.length} solution clue(s) locked`);
  }

  return {
    status: result.ok ? "pass" : "fail",
    details: {
      total_clues: result.total_clues,
      gated_clue_count: result.gated_clue_count,
      unknown_requires: result.unknown_requires,
      self_references: result.self_references,
      acyclic: result.acyclic,
      cycles: result.cycles,
      undiscoverable: result.undiscoverable,
      locked_solution_clues: result.locked_solution_clues,
      paths: result.paths,
      summary: problems.length === 0 ? "clue graph is sound" : problems.join("; "),
    },
  };
}
