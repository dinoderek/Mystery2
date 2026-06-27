import { z } from "zod";

export const schema = z.object({
  fields: z.array(
    z.object({
      field: z.string(),
      flesch_kincaid_grade: z.number(),
      within_target: z.boolean(),
      issue: z.string().nullable(),
      suggested_rewrite: z.string().nullable(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
