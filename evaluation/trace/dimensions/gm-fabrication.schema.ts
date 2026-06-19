import { z } from "zod";

export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      claim: z.string(),
      why: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
