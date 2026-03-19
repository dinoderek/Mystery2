import { z } from "zod";

const BlueprintPathSchema = z
  .string()
  .min(1)
  .describe(
    "JSON-style path into the blueprint, for example world.locations[1].clues[0] or ground_truth.timeline[2].",
  );

const IssueSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Short label for a concrete problem detected in the blueprint."),
  details: z
    .string()
    .min(1)
    .describe(
      "Direct explanation of what is wrong and why it weakens the blueprint as a mystery.",
    ),
  evidence_paths: z
    .array(BlueprintPathSchema)
    .min(1)
    .describe(
      "Blueprint paths that support the issue. Include all key fields needed to verify the claim.",
    ),
});

const PassingDimensionResultSchema = z.object({
  yes: z.literal(true),
  reasoning: z
    .string()
    .min(1)
    .describe("Short explanation of why this dimension passes."),
  issues: z
    .array(IssueSchema)
    .max(0)
    .default([])
    .describe("Must be an empty array when the dimension passes."),
});

const FailingDimensionResultSchema = z.object({
  yes: z.literal(false),
  reasoning: z
    .string()
    .default("")
    .describe(
      "Optional empty string placeholder when the dimension fails. Do not place issue details here.",
    ),
  issues: z
    .array(IssueSchema)
    .min(1)
    .describe("Concrete problems that caused this dimension to fail."),
});

export const EvaluationDimensionResultSchema = z
  .discriminatedUnion("yes", [
    PassingDimensionResultSchema,
    FailingDimensionResultSchema,
  ])
  .describe(
    "Binary pass/fail result for one evaluation dimension, with concise reasoning for passes and concrete issues for failures.",
  );

export const ClueRoleSchema = z
  .enum([
    "direct_evidence",
    "supporting_evidence",
    "suspect_elimination",
    "red_herring",
    "red_herring_elimination",
    "corroboration",
    "dead_end",
    "irrelevant",
    "flavor",
  ])
  .describe(
    "How a clue or knowledge item functions inside the mystery. Flavor is primarily intended for optional non-solutional knowledge items.",
  );

const SolutionPathStepSchema = z.object({
  claim: z
    .string()
    .min(1)
    .describe("One reasoning step in the solution path."),
  evidence_paths: z
    .array(BlueprintPathSchema)
    .min(1)
    .describe(
      "Blueprint paths that justify this reasoning step. Prefer the smallest set of relevant paths.",
    ),
});

export const SolutionPathSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Short label for the route, for example 'alibi contradiction path'."),
  conclusion: z
    .string()
    .min(1)
    .describe(
      "What this path establishes, such as the culprit, motive, or the decisive contradiction.",
    ),
  reasoning_steps: z
    .array(SolutionPathStepSchema)
    .min(1)
    .describe("Ordered reasoning chain showing how the player can solve the mystery."),
});

const ClueAuditEntrySchema = z.object({
  path: BlueprintPathSchema.describe(
    "Path to one specific location clue or one specific character knowledge item.",
  ),
  role: ClueRoleSchema,
  reasoning: z
    .string()
    .min(1)
    .describe("Why this clue has the assigned role."),
  related_solution_paths: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Names of solution paths that meaningfully use this clue. Leave empty when not applicable.",
    ),
});

export const RedHerringSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe("Short description of the false lead or suspicious side plot."),
  appears_suspicious_because: z
    .string()
    .min(1)
    .describe("Why the investigator could reasonably suspect it."),
  real_explanation: z
    .string()
    .min(1)
    .describe("The grounded in-world explanation behind the false lead."),
  resolution: z
    .string()
    .min(1)
    .describe("How the blueprint allows the investigator to resolve or eliminate it."),
  evidence_paths: z
    .array(BlueprintPathSchema)
    .min(1)
    .describe("Blueprint paths that establish both the suspicion and its real explanation."),
});

export const DeadEndSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe("Short description of the dead end."),
  why_it_is_a_dead_end: z
    .string()
    .min(1)
    .describe(
      "Why this path cannot be resolved from the blueprint as written, or why it points to unsupported facts.",
    ),
  evidence_paths: z
    .array(BlueprintPathSchema)
    .min(1)
    .describe("Blueprint paths that demonstrate the dead end."),
});

export const RedundantClueSchema = z.object({
  path: BlueprintPathSchema.describe(
    "Path to the redundant clue or knowledge item.",
  ),
  overlaps_with_paths: z
    .array(BlueprintPathSchema)
    .min(1)
    .describe(
      "Other clue or knowledge paths that already provide the same information or function.",
    ),
  reasoning: z
    .string()
    .min(1)
    .describe(
      "Why this item is redundant rather than useful corroboration or distinct elimination evidence.",
    ),
});

export const BlueprintEvaluationOutputSchema = z
  .object({
    overall_pass: z
      .boolean()
      .describe(
        "True only when every evaluation dimension passes and no blocking structural issues are present.",
      ),
    dimensions: z.object({
      brief_alignment: EvaluationDimensionResultSchema,
      ground_truth_quality: EvaluationDimensionResultSchema,
      solvable_paths_exist: EvaluationDimensionResultSchema,
      location_clues_have_role: EvaluationDimensionResultSchema,
      knowledge_items_have_role: EvaluationDimensionResultSchema,
      red_herrings_are_fair: EvaluationDimensionResultSchema,
      no_dead_ends: EvaluationDimensionResultSchema,
      consistent_facts: EvaluationDimensionResultSchema,
      no_redundant_clues: EvaluationDimensionResultSchema,
    }),
    solution_paths: z
      .array(SolutionPathSchema)
      .describe(
        "Every valid solution route the evaluator can identify from player-accessible evidence.",
      ),
    location_clue_audit: z
      .array(ClueAuditEntrySchema)
      .describe("Audit of every location clue in the blueprint."),
    knowledge_audit: z
      .array(ClueAuditEntrySchema)
      .describe("Audit of every character knowledge item in the blueprint."),
    red_herrings: z
      .array(RedHerringSchema)
      .describe("All detected red herrings or fair false plots."),
    dead_ends: z
      .array(DeadEndSchema)
      .describe("All detected dead ends."),
    redundant_clues: z
      .array(RedundantClueSchema)
      .describe("All detected redundant clues or redundant knowledge items."),
  })
  .superRefine((value, context) => {
    const dimensionResults = Object.values(value.dimensions);
    const allDimensionsPass = dimensionResults.every((result) => result.yes);

    if (value.overall_pass !== allDimensionsPass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "overall_pass must be true only when every evaluation dimension passes.",
        path: ["overall_pass"],
      });
    }

    if (value.dimensions.solvable_paths_exist.yes && value.solution_paths.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "solution_paths must contain at least one route when solvable_paths_exist is true.",
        path: ["solution_paths"],
      });
    }

    if (value.dimensions.no_dead_ends.yes && value.dead_ends.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "dead_ends must be empty when the no_dead_ends dimension passes.",
        path: ["dead_ends"],
      });
    }

    if (value.dimensions.no_redundant_clues.yes && value.redundant_clues.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "redundant_clues must be empty when the no_redundant_clues dimension passes.",
        path: ["redundant_clues"],
      });
    }
  });

export type EvaluationDimensionResult = z.infer<
  typeof EvaluationDimensionResultSchema
>;
export type SolutionPath = z.infer<typeof SolutionPathSchema>;
export type RedHerring = z.infer<typeof RedHerringSchema>;
export type DeadEnd = z.infer<typeof DeadEndSchema>;
export type RedundantClue = z.infer<typeof RedundantClueSchema>;
export type BlueprintEvaluationOutput = z.infer<
  typeof BlueprintEvaluationOutputSchema
>;
