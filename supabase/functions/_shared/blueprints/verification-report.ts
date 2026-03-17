import { z } from "npm:zod";

const FindingSchema = z.object({
  rule_id: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
});

const SolvePathActionSchema = z.object({
  action_type: z.enum(["move", "search", "talk"]),
  location_key: z.string().min(1),
  character_key: z.string().min(1).optional(),
  gained_evidence_keys: z.array(z.string().min(1)),
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
  solve_path: z.object({
    starting_location_key: z.string().min(1),
    starting_evidence_keys: z.array(z.string().min(1)),
    collected_evidence_keys: z.array(z.string().min(1)),
    actions: z.array(SolvePathActionSchema),
  }).nullable().optional(),
});

export type VerificationReport = z.infer<typeof VerificationReportSchema>;
