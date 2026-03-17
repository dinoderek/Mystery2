import { z } from "npm:zod";

const FindingSchema = z.object({
  rule_id: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
});

export const VerificationReportSchema = z.object({
  stage: z.literal("verify"),
  blueprint_id: z.string().uuid(),
  blueprint_path: z.string().min(1),
  run_id: z.string().min(1).nullable().optional(),
  status: z.enum(["pass", "warn", "fail"]),
  blocking_findings: z.array(FindingSchema),
  warning_findings: z.array(FindingSchema),
  info_findings: z.array(FindingSchema),
  computed_metrics: z.object({
    location_count: z.number().int().nonnegative(),
    character_count: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
    essential_evidence_count: z.number().int().nonnegative(),
    required_actions: z.number().int().nonnegative(),
    action_budget_limit: z.number().int().nonnegative(),
  }),
});

export type VerificationReport = z.infer<typeof VerificationReportSchema>;
