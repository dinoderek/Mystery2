import { z } from "zod";

/**
 * Spoiler discipline: did pre-accusation narration give away ground truth?
 * Complements the mechanical spoiler_leak check, which only catches long
 * verbatim copying — this judge covers paraphrase, implication, and
 * confirmation.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      kind: z.enum([
        "culprit",
        "motive",
        "mechanism",
        "hidden_action",
        "deduction",
        "confirmation",
      ]),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
