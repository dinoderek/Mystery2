/**
 * The mechanical check of a clue-graph case: `validateClueGraph`, the same
 * validator the loader and `npm run validate:clue-graph` run. It passes, or
 * fails listing every issue by the path it names.
 */

import { ZodError } from "zod";

import { validateClueGraph } from "../../packages/shared/src/clue-graph-validator.ts";
import type { MechanicalCheck } from "./mechanical.ts";

export function runClueGraphChecks({ blueprintCandidate }: { blueprintCandidate: unknown }): MechanicalCheck[] {
  try {
    validateClueGraph(blueprintCandidate);
    return [{ id: "clue_graph_valid", kind: "mechanical", status: "pass", details: null }];
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return [{ id: "clue_graph_valid", kind: "mechanical", status: "fail", details: { issues } }];
  }
}
