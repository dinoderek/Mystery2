import { z } from "zod";

/**
 * Clue release discipline: did the narration deliver the clues it recorded,
 * record the clues it delivered, and respect the discovery graph's gates?
 * The mechanical clue_accounting check covers id validity, scope, and repeats;
 * this judge covers the narration-vs-record comparison code cannot make.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      kind: z.enum([
        "unrecorded",
        "unsupported",
        "distorted",
        "premature",
        "wrong_source",
        "withheld",
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
