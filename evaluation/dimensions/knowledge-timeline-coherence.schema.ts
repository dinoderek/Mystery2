import { z } from "zod";

/**
 * Knowledge coherence and timeline coherence in one judge, a candidate. Each
 * finding names the question it answers as its truth-set kind; the shape is
 * the game-master judges' findings without `sequence`, since a blueprint has
 * no turns.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["minor", "major"]),
      kind: z.enum(["timeline_coherence", "knowledge_coherence"]),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
