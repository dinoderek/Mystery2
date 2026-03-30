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
});

export type StoryBrief = z.infer<typeof StoryBriefSchema>;
