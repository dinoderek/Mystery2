import { z } from "zod";

export const schema = z.object({
  mini_mysteries: z.array(
    z.object({
      path_id: z.string(),
      group: z.enum(["solution", "red_herring", "suspect_elimination"]),
      graph_is_sensible: z.boolean(),
      is_one_giant_chain: z.boolean(),
      creates_dead_end: z.boolean(),
      has_ungated_entry: z.boolean(),
      reasoning: z.string(),
    }),
  ),
  rationales_are_concrete: z.boolean(),
  gating_creates_momentum: z.boolean(),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
