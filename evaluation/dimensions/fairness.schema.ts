import { z } from "zod";

export const schema = z.object({
  non_culprits: z.array(
    z.object({
      character_id: z.string(),
      ruled_out: z.boolean(),
      ruling_evidence: z.string().nullable(),
      reasoning: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
