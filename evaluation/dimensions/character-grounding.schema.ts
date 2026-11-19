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
  reactions: z.array(
    z.object({
      character_id: z.string(),
      clue_id: z.string(),
      concedes_only_what_clue_shows: z.boolean(),
      note: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
