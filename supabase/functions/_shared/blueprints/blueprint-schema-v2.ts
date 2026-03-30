// V2 blueprint schema for Supabase Edge Functions.
// Derived from packages/shared/src/blueprint-schema-v2.ts.
// Used by image-serving endpoints that require V2 blueprints.

import { z } from "npm:zod";

const BlueprintV2IdSchema = z.string().trim().min(1);

const BlueprintV2ClueRoleEnum = [
  "direct_evidence",
  "supporting_evidence",
  "suspect_elimination",
  "red_herring",
  "red_herring_elimination",
  "corroboration",
  "alibi_knowledge",
  "location_hint",
  "witness_testimony",
  "motive_knowledge",
] as const;

const BlueprintV2LocationClueSchema = z.object({
  id: BlueprintV2IdSchema,
  text: z.string().trim().min(1),
  role: z.enum(BlueprintV2ClueRoleEnum),
});

const BlueprintV2CharacterClueSchema = z.object({
  id: BlueprintV2IdSchema,
  text: z.string().trim().min(1),
  role: z.enum(BlueprintV2ClueRoleEnum),
  about_character_id: z.string().optional(),
  hint_location_id: z.string().optional(),
});

const BlueprintV2AgendaSchema = z.object({
  type: z.enum([
    "self_protect",
    "protect_other",
    "implicate_other",
    "conditional_reveal",
  ]),
  strategy: z.string().trim().min(1),
  priority: z.enum(["high", "medium", "low"]),
  details: z.string().trim().min(1),
  target_character_id: z.string().optional(),
  gated_clue_id: z.string().optional(),
  condition: z
    .enum([
      "confronted_with_evidence",
      "clever_questioning",
      "bluff",
      "trust_established",
      "pressure",
    ])
    .optional(),
  yields_to_clue_ids: z.array(z.string()).optional(),
});

const BlueprintV2LocationSchema = z.object({
  id: BlueprintV2IdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  location_image_id: z.string().optional(),
  clues: z.array(BlueprintV2LocationClueSchema),
});

const BlueprintV2CharacterSchema = z.object({
  id: BlueprintV2IdSchema,
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  location_id: BlueprintV2IdSchema,
  sex: z.enum(["male", "female"]),
  appearance: z.string().trim().min(1),
  background: z.string().trim().min(1),
  personality: z.string().trim().min(1),
  initial_attitude_towards_investigator: z.string().trim().min(1),
  stated_alibi: z.string().trim().min(1).nullable(),
  motive: z.string().trim().min(1).nullable(),
  is_culprit: z.boolean(),
  portrait_image_id: z.string().optional(),
  clues: z.array(BlueprintV2CharacterClueSchema),
  flavor_knowledge: z.array(z.string().trim().min(1)),
  actual_actions: z.array(
    z.object({
      sequence: z.number().int().positive(),
      summary: z.string().trim().min(1),
    }),
  ),
  agendas: z.array(BlueprintV2AgendaSchema).default([]),
});

const BlueprintV2CoverImageSchema = z.object({
  description: z.string().trim().min(1),
  location_ids: z.array(BlueprintV2IdSchema),
  character_ids: z.array(BlueprintV2IdSchema),
});

export const BlueprintV2Schema = z.object({
  schema_version: z.literal("v2"),
  id: z.string().uuid(),
  metadata: z.object({
    title: z.string().trim().min(1),
    one_liner: z.string().trim().min(1),
    target_age: z.number().int().positive(),
    time_budget: z.number().int().positive(),
    art_style: z.string().trim().min(1).optional(),
    visual_direction: z
      .object({
        art_style: z.string().trim().min(1),
        color_palette: z.string().trim().min(1),
        mood: z.string().trim().min(1),
        lighting: z.string().trim().min(1),
        texture: z.string().trim().min(1).optional(),
      })
      .optional(),
    image_id: z.string().optional(),
  }),
  narrative: z.object({
    premise: z.string().trim().min(1),
    starting_knowledge: z.object({
      mystery_summary: z.string().trim().min(1),
      locations: z.array(
        z.object({
          location_id: BlueprintV2IdSchema,
          summary: z.string().trim().min(1),
        }),
      ),
      characters: z.array(
        z.object({
          character_id: BlueprintV2IdSchema,
          summary: z.string().trim().min(1),
        }),
      ),
    }),
  }),
  world: z.object({
    starting_location_id: BlueprintV2IdSchema,
    locations: z.array(BlueprintV2LocationSchema),
    characters: z.array(BlueprintV2CharacterSchema),
  }),
  cover_image: BlueprintV2CoverImageSchema,
  ground_truth: z.object({
    what_happened: z.string().trim().min(1),
    why_it_happened: z.string().trim().min(1),
    timeline: z.array(z.string().trim().min(1)),
  }),
  solution_paths: z.array(
    z.object({
      id: BlueprintV2IdSchema,
      summary: z.string().trim().min(1),
      description: z.string().trim().min(1).optional(),
      location_clue_ids: z.array(BlueprintV2IdSchema),
      character_clue_ids: z.array(BlueprintV2IdSchema),
    }),
  ),
  red_herrings: z.array(
    z.object({
      id: BlueprintV2IdSchema,
      summary: z.string().trim().min(1),
      description: z.string().trim().min(1).optional(),
      location_clue_ids: z.array(BlueprintV2IdSchema),
      character_clue_ids: z.array(BlueprintV2IdSchema),
    }),
  ),
  suspect_elimination_paths: z.array(
    z.object({
      id: BlueprintV2IdSchema,
      summary: z.string().trim().min(1),
      description: z.string().trim().min(1).optional(),
      location_clue_ids: z.array(BlueprintV2IdSchema),
      character_clue_ids: z.array(BlueprintV2IdSchema),
    }),
  ),
});

export type BlueprintV2 = z.infer<typeof BlueprintV2Schema>;
