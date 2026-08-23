import { z } from "zod";

/**
 * Roleplay fidelity: does the game master perform the authored character and
 * the required narrator voice? Shares the battery's common finding shape
 * (sequence + severity + kind + quote + why + refers_to) so a consumer can read
 * findings from any game-master judge without special-casing.
 */
export const schema = z.object({
  findings: z.array(
    z.object({
      sequence: z.number().int(),
      severity: z.enum(["minor", "major"]),
      kind: z.enum([
        "persona",
        "voice",
        "alibi",
        "agenda",
        "tell",
        "knowledge",
        "narrator_voice",
      ]),
      quote: z.string(),
      why: z.string(),
      refers_to: z.string().nullable().optional(),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
  reasoning: z.string(),
});

export type JudgeOutput = z.infer<typeof schema>;
