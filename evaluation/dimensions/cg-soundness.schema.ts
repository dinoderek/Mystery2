import { z } from "zod";

export const schema = z
  .object({
    conclusions: z.array(
      z
        .object({
          conclusion_id: z.string(),
          follows: z.enum(["yes", "partly", "no"]),
          note: z.string(),
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          severity: z.enum(["major", "minor"]),
          kind: z.enum(["does_not_follow", "wrong_target", "says_more"]),
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
