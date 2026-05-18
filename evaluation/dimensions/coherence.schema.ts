import { z } from "zod";

export const schema = z.object({
  issues: z.array(
    z.object({
      kind: z.enum(["timeline", "knowledge", "geography"]),
      subject: z.string(),
      description: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
