import { z } from "zod";

import { MAX_TARGET_AGE, MIN_TARGET_AGE } from "../../shared/src/age-profile.ts";
import { CLUE_GRAPH_SIZES, SizeOverridesSchema } from "../../shared/src/clue-graph-sizes.ts";

/**
 * A brief for a clue-graph case (`docs/clue-graph.md`): the story asked for,
 * the reading age and the size. The case carries the size as `metadata.size`
 * and any overrides as `metadata.size_overrides`, so the validator holds it to
 * them on its own; `targetAge` becomes `metadata.target_age`.
 */
export const ClueGraphBriefSchema = z
  .object({
    brief: z.string().trim().min(1),
    targetAge: z.number().int().min(MIN_TARGET_AGE).max(MAX_TARGET_AGE),
    size: z.enum(CLUE_GRAPH_SIZES),
    /** Counts set apart from the size, each replacing that count's bounds. */
    sizeOverrides: SizeOverridesSchema.optional(),
    titleHint: z.string().trim().min(1).optional(),
    mustInclude: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type ClueGraphBrief = z.infer<typeof ClueGraphBriefSchema>;
