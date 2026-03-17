import { z } from "zod";

const StableKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const VisualSchema = z.object({
  summary: z.string().min(1),
  visual_anchors: z.array(z.string().min(1)).min(1),
});

export const BlueprintV2Schema = z.object({
  id: z.string().uuid(),
  metadata: z.object({
    title: z.string().min(1),
    one_liner: z.string().min(1),
    target_age: z.number().int().positive(),
    time_budget: z.number().int().positive(),
    visual: z.object({
      style: z.string().min(1),
      mood: z.string().min(1),
      palette: z.string().min(1),
      lighting_or_atmosphere: z.string().min(1),
      cover: VisualSchema,
    }),
    image_id: z.string().optional(),
  }),
  narrative: z.object({
    premise: z.string().min(1),
    starting_knowledge: z.array(z.string().min(1)),
  }),
  world: z.object({
    starting_location_key: StableKeySchema,
    locations: z.array(z.object({
      location_key: StableKeySchema,
      name: z.string().min(1),
      description: z.string().min(1),
      search_context: z.array(z.string().min(1)).min(1),
      visual: VisualSchema,
      location_image_id: z.string().optional(),
    })).min(3),
    characters: z.array(z.object({
      character_key: StableKeySchema,
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      location_key: StableKeySchema,
      roleplay: z.object({
        persona: z.string().min(1),
        background: z.string().min(1),
        attitude: z.string().min(1),
      }),
      private_alibi: z.string().nullable(),
      private_motive: z.string().nullable(),
      visual: VisualSchema,
      portrait_image_id: z.string().optional(),
    })).min(3),
  }),
  evidence: z.array(z.object({
    evidence_key: StableKeySchema,
    player_text: z.string().min(1),
    fact_summary: z.string().min(1),
    essential: z.boolean(),
    related_location_keys: z.array(StableKeySchema),
    related_character_keys: z.array(StableKeySchema),
    acquisition_paths: z.array(z.object({
      surface: z.enum(["start", "move", "search", "talk"]),
      location_key: StableKeySchema.optional(),
      character_key: StableKeySchema.optional(),
    })).min(1),
  })).min(3),
  ground_truth: z.object({
    culprit_character_key: StableKeySchema,
    what_happened: z.string().min(1),
    why_it_happened: z.string().min(1),
    explanation: z.string().min(1),
    suspect_truths: z.array(z.object({
      character_key: StableKeySchema,
      actual_activity: z.string().min(1),
      stated_alibi: z.string().nullable(),
      motive: z.string().nullable(),
      contradiction_evidence_keys: z.array(StableKeySchema),
    })).min(1),
    timeline: z.array(z.object({
      timeline_entry_key: StableKeySchema,
      order: z.number().int().nonnegative(),
      summary: z.string().min(1),
      location_key: StableKeySchema,
      character_key: StableKeySchema,
    })).min(1),
  }),
});

const ReportFindingSchema = z.object({
  rule_id: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
});

export const VerificationReportSchema = z.object({
  stage: z.literal("verify"),
  blueprint_id: z.string().uuid().nullable(),
  blueprint_path: z.string().min(1),
  run_id: z.string().nullable().optional(),
  status: z.enum(["pass", "warn", "fail"]),
  blocking_findings: z.array(ReportFindingSchema),
  warning_findings: z.array(ReportFindingSchema),
  info_findings: z.array(ReportFindingSchema),
  computed_metrics: z.object({
    location_count: z.number().int().nonnegative(),
    character_count: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
    essential_evidence_count: z.number().int().nonnegative(),
    required_actions: z.number().int().nonnegative(),
    action_budget_limit: z.number().int().nonnegative(),
  }),
});

export const AIJudgeReportSchema = z.object({
  stage: z.literal("judge"),
  judge_version: z.string().min(1),
  blueprint_id: z.string().uuid(),
  blueprint_path: z.string().min(1).optional(),
  run_id: z.string().nullable().optional(),
  dimension_scores: z.object({
    coherence_fairness: z.number().min(0).max(5),
    spoiler_safety: z.number().min(0).max(5),
    age_fit: z.number().min(0).max(5),
    image_readiness: z.number().min(0).max(5),
  }),
  blocking_findings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  })),
  advisory_findings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  })),
  promotion_recommendation: z.enum(["promote", "revise", "reject"]),
  citations: z.array(z.object({
    path: z.string().min(1),
    note: z.string().min(1),
  })).min(1),
  repair_focus: z.string().min(1).nullable().optional(),
});
