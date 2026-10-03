import { z } from "zod";

export const schema = z.object({
  issues: z.array(
    z.object({
      kind: z.enum([
        "observability",
        "false_knowledge",
        "physical_fact",
        "pre_discovery_leak",
      ]),
      subject: z.string(),
      clue_ids: z.array(z.string()),
      description: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
