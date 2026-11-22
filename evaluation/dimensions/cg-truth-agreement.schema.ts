import { z } from "zod";

export const schema = z
  .object({
    findings: z.array(
      z
        .object({
          severity: z.enum(["major", "minor"]),
          kind: z.enum([
            "contradicts_timeline",
            "false_is_true",
            "retraction_does_not_contradict",
            "knows_gives_away",
            "detail_mismatch",
          ]),
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
