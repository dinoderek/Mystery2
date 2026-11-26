import { z } from "zod";

import { CLUE_GRAPH_SIZES, SizeOverridesSchema } from "../../shared/src/clue-graph-sizes.ts";

/**
 * A brief for a clue-graph case (`docs/clue-graph.md`): the story asked for
 * and the size. The case carries the size as `metadata.size` and any overrides
 * as `metadata.size_overrides`, so the validator holds it to them on its own.
 */
export const ClueGraphBriefSchema = z
  .object({
    brief: z.string().trim().min(1),
    size: z.enum(CLUE_GRAPH_SIZES),
    /** Counts set apart from the size, each replacing that count's bounds. */
    sizeOverrides: SizeOverridesSchema.optional(),
    titleHint: z.string().trim().min(1).optional(),
    mustInclude: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type ClueGraphBrief = z.infer<typeof ClueGraphBriefSchema>;
