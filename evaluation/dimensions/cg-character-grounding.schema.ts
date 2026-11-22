import { z } from "zod";

export const schema = z
  .object({
    characters: z.array(
      z
        .object({
          character_id: z.string(),
          fits: z.boolean(),
          note: z.string(),
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          severity: z.enum(["major", "minor"]),
          kind: z.enum(["could_not_know", "out_of_character", "appearance_conflict", "role_mismatch", "thin"]),
          ids: z.array(z.string()).min(1),
          explanation: z.string().min(1),
        })
        .strict(),
    ),
    verdict: z.enum(["pass", "fail"]),
    reasoning: z.string(),
  })
  .strict();

export type JudgeOutput = z.infer<typeof schema>;
