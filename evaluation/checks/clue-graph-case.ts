/**
 * The mechanical check of a clue-graph case: `validateClueGraph`, the same
 * validator the loader and `npm run validate:clue-graph` run. With the brief a
 * case was generated from, it also holds the case to that brief's reading age,
 * size and size overrides, which the validator then checks the story against.
 * It passes, or fails listing every issue by the path it names.
 */

import { isDeepStrictEqual } from "node:util";

import { ZodError } from "zod";

import { ClueGraphBriefSchema } from "../../packages/blueprint-generator/src/clue-graph-brief.ts";
import { validateClueGraph } from "../../packages/shared/src/clue-graph-validator.ts";

/** One mechanical check's result; `details` holds what failed, or is null. */
export interface MechanicalCheck {
  id: string;
  kind: "mechanical";
  status: "pass" | "fail";
  details: Record<string, unknown> | null;
}

function metadataOf(candidate: unknown): Record<string, unknown> {
  const metadata = (candidate as { metadata?: unknown } | null)?.metadata;
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
}

/** Where the case departs from what its brief asks for; a brief that is not a clue-graph brief is one issue. */
export function briefIssues(brief: unknown, candidate: unknown): string[] {
  const parsed = ClueGraphBriefSchema.safeParse(brief);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `brief.${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  const metadata = metadataOf(candidate);
  const asked: Array<[field: string, wanted: unknown, from: string]> = [
    ["target_age", parsed.data.targetAge, "targetAge"],
    ["size", parsed.data.size, "size"],
    ["size_overrides", parsed.data.sizeOverrides, "sizeOverrides"],
  ];
  return asked
    .filter(([field, wanted]) => !isDeepStrictEqual(metadata[field], wanted))
    .map(([field, wanted, from]) => `metadata.${field}: the brief's ${from} is ${JSON.stringify(wanted) ?? "not given"}, the case has ${JSON.stringify(metadata[field]) ?? "none"}`);
}

export function runClueGraphChecks({ brief, blueprintCandidate }: { brief?: unknown; blueprintCandidate: unknown }): MechanicalCheck[] {
  const issues = brief === undefined || brief === null ? [] : briefIssues(brief, blueprintCandidate);
  try {
    validateClueGraph(blueprintCandidate);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    issues.push(...error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
  }
  if (issues.length === 0) return [{ id: "clue_graph_valid", kind: "mechanical", status: "pass", details: null }];
  return [{ id: "clue_graph_valid", kind: "mechanical", status: "fail", details: { issues } }];
}
