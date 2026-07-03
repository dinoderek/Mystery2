import { z } from "zod";

export const schema = z.object({
  target_age: z.number().int(),
  estimated_reading_age: z.number().int(),
  findings: z.array(
    z.object({
      path: z.string(),
      quote: z.string(),
      kind: z.enum([
        "vocabulary",
        "sentence_length",
        "figurative_language",
        "clarity",
      ]),
      why: z.string(),
      suggestion: z.string().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
