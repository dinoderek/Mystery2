import { z } from "npm:zod";

const JudgeFindingSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

const CitationSchema = z.object({
  path: z.string().min(1),
  note: z.string().min(1),
});

export const AIJudgeReportSchema = z.object({
  stage: z.literal("judge"),
  judge_version: z.string().min(1),
  blueprint_id: z.string().uuid(),
  blueprint_path: z.string().min(1).optional(),
  run_id: z.string().min(1).nullable().optional(),
  dimension_scores: z.object({
    coherence_fairness: z.number().min(0).max(5),
    spoiler_safety: z.number().min(0).max(5),
    age_fit: z.number().min(0).max(5),
    image_readiness: z.number().min(0).max(5),
  }),
  blocking_findings: z.array(JudgeFindingSchema),
  advisory_findings: z.array(JudgeFindingSchema),
  promotion_recommendation: z.enum([
    "promote",
    "revise",
    "reject",
  ]),
  citations: z.array(CitationSchema).min(1),
  repair_focus: z.string().min(1).nullable().optional(),
});

export type AIJudgeReport = z.infer<typeof AIJudgeReportSchema>;
