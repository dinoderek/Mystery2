import { z } from "zod";

import { BLUEPRINT_KINDS } from "../lib/truth/kinds.ts";

/**
 * Every blueprint question in one judge, a candidate. Each finding names the
 * question it answers as its truth-set kind; the shape is the game-master
 * judges' findings without `sequence`, since a blueprint has no turns.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["minor", "major"]),
      kind: z.enum(BLUEPRINT_KINDS),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
