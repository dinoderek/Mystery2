import { z } from "zod";

export const schema = z.object({
  paths: z.array(
    z.object({
      id: z.string(),
      works: z.boolean(),
      reasoning: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
