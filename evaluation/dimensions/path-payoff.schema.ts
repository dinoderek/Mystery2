import { z } from "zod";

export const schema = z.object({
  paths: z.array(
    z.object({
      id: z.string(),
      group: z.enum(["solution", "red_herring", "suspect_elimination"]),
      payoff: z.string(),
      payoff_source: z.enum(["authored", "derived"]),
      verdict: z.enum(["pass", "fail"]),
      reasoning: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
