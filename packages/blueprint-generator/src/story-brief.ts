import { z } from "zod";

export const StoryBriefSchema = z.object({
  brief: z.string().trim().min(1),
  targetAge: z.number().int().positive(),
  timeBudget: z.number().int().positive().optional(),
  titleHint: z.string().trim().min(1).optional(),
  artStyle: z.string().trim().min(1).optional(),
  mustInclude: z.array(z.string().trim().min(1)).optional(),
  culprits: z.number().int().positive().optional().describe("Number of culprits. Default: 1."),
  suspects: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Number of red-herring suspects (characters with apparent motive and opportunity)."),
  witnesses: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Number of witness characters (know something interesting but are not suspects)."),
  locations: z.number().int().positive().optional().describe("Number of locations."),
  redHerringTrails: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Number of red herring plot threads to weave in."),
  coverUps: z
    .boolean()
    .optional()
    .describe("Whether suspects should have cover stories or false alibis."),
  eliminationComplexity: z
    .enum(["simple", "moderate", "complex"])
    .optional()
    .describe(
      "Complexity of suspect elimination. simple: one clue rules them out. "
        + "moderate: cross-reference 2+ clues. complex: break through agendas or multi-step reasoning.",
    ),
  minPathLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Hard floor on solution-path length: the shortest route to the culprit must "
        + "require at least this many distinct, NECESSARY clues (redundant corroboration "
        + "does not count). Enforced by the solve_depth evaluation; falls back to the "
        + "registry default when unset.",
    ),
  targetPathLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Desired solution-path length the generator should aim for. A generation hint "
        + "only — not enforced by judges. Should be >= minPathLength when both are set.",
    ),
});

export type StoryBrief = z.infer<typeof StoryBriefSchema>;
