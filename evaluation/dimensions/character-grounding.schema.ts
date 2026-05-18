import { z } from "zod";

export const schema = z.object({
  characters: z.array(
    z.object({
      character_id: z.string(),
      first_name: z.string(),
      topics: z.array(
        z.object({
          topic: z.string(),
          status: z.enum(["grounded", "thin", "absent"]),
          note: z.string(),
        }),
      ),
      passes: z.boolean(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
