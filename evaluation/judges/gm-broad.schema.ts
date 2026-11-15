import { z } from "zod";

import { GAME_KINDS } from "../lib/truth/kinds.ts";

/**
 * Every game-side question in one judge, a candidate. Shares the battery's
 * common finding shape, with the truth-set kind of the question each finding
 * answers as its `kind`.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      kind: z.enum(GAME_KINDS),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
