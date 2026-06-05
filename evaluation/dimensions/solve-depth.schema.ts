import { z } from "zod";

export const schema = z.object({
  paths: z.array(
    z.object({
      id: z.string(),
      reaches_culprit: z.boolean(),
      necessary_clues: z.array(z.string()),
      length: z.number().int().nonnegative(),
      reasoning: z.string(),
    }),
  ),
  solvable: z.boolean(),
  shortest_path_id: z.string().nullable(),
  min_length: z.number().int().nonnegative(),
  min_required: z.number().int().nonnegative(),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
