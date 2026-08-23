import { z } from "zod";

/**
 * Fabrication / world grounding: did the game master invent material facts the
 * blueprint does not support? Shares the battery's common finding shape.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      kind: z.enum(["person", "place", "object", "event", "contradiction"]),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
