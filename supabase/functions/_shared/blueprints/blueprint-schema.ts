import { z } from "npm:zod";

const STABLE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const StableKeySchema = z.string().regex(
  STABLE_KEY_PATTERN,
  "Expected a stable slug key (lowercase letters, numbers, and hyphens).",
);

const TargetVisualSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("Spoiler-safe visual summary used for static image prompting."),
  visual_anchors: z
    .array(z.string().min(1))
    .min(1)
    .describe("Short spoiler-safe visual anchors for image composition."),
});

const MetadataVisualSchema = z.object({
  style: z.string().min(1),
  mood: z.string().min(1),
  palette: z.string().min(1),
  lighting_or_atmosphere: z.string().min(1),
  cover: TargetVisualSchema,
});

const AcquisitionPathSchema = z.object({
  surface: z.enum(["start", "move", "search", "talk"]),
  location_key: StableKeySchema.optional(),
  character_key: StableKeySchema.optional(),
});

export const EvidenceSchema = z.object({
  evidence_key: StableKeySchema,
  player_text: z
    .string()
    .min(1)
    .describe("Canonical player-facing evidence text surfaced during gameplay."),
  fact_summary: z
    .string()
    .min(1)
    .describe("Internal fact summary used for verification and judging."),
  essential: z.boolean(),
  related_location_keys: z.array(StableKeySchema).default([]),
  related_character_keys: z.array(StableKeySchema).default([]),
  acquisition_paths: z.array(AcquisitionPathSchema).min(1),
});

export const CharacterSchema = z.object({
  character_key: StableKeySchema,
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  location_key: StableKeySchema.describe(
    "Stable key referencing the character's current/default location.",
  ),
  roleplay: z.object({
    persona: z.string().min(1),
    background: z.string().min(1),
    attitude: z.string().min(1),
  }),
  private_alibi: z
    .string()
    .nullable()
    .describe("Private character alibi text used in backend-only roleplay/judging."),
  private_motive: z
    .string()
    .nullable()
    .describe("Private motive text used in backend-only reasoning flows."),
  visual: TargetVisualSchema,
  portrait_image_id: z
    .string()
    .optional()
    .describe(
      "Optional static portrait image identifier shown in talk-mode narration panels.",
    ),
});

export const LocationSchema = z.object({
  location_key: StableKeySchema,
  name: z.string().min(1),
  description: z
    .string()
    .min(1)
    .describe("Reusable player-facing move/scene description."),
  search_context: z
    .array(z.string().min(1))
    .min(1)
    .describe("Public search-relevant context that remains spoiler-safe."),
  visual: TargetVisualSchema,
  location_image_id: z
    .string()
    .optional()
    .describe(
      "Optional static scene image identifier shown when the investigator moves here.",
    ),
});

export const TimelineEntrySchema = z.object({
  timeline_entry_key: StableKeySchema,
  order: z.number().int().nonnegative(),
  summary: z.string().min(1),
  location_key: StableKeySchema,
  character_key: StableKeySchema,
});

const SuspectTruthSchema = z.object({
  character_key: StableKeySchema,
  actual_activity: z.string().min(1),
  stated_alibi: z.string().nullable(),
  motive: z.string().nullable(),
  contradiction_evidence_keys: z.array(StableKeySchema),
});

function uniqueKeys<T>(
  values: T[],
  readKey: (value: T) => string,
): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const raw = readKey(value);
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([entry]) => entry);
}

export const BlueprintSchema = z.object({
  id: z.string().uuid(),
  metadata: z.object({
    title: z.string().min(1),
    one_liner: z
      .string()
      .min(1)
      .describe(
        "A one-sentence summary displayed in the mystery selection screen.",
      ),
    target_age: z.number().int().positive(),
    time_budget: z.number().int().positive(),
    visual: MetadataVisualSchema,
    image_id: z
      .string()
      .optional()
      .describe(
        "Optional static blueprint cover image identifier for the mystery selection screen.",
      ),
  }),
  narrative: z.object({
    premise: z
      .string()
      .min(1)
      .describe("The hook provided to the player when the game starts."),
    starting_knowledge: z
      .array(z.string().min(1))
      .describe("Facts the player knows immediately."),
  }),
  world: z.object({
    starting_location_key: StableKeySchema,
    locations: z.array(LocationSchema).min(3),
    characters: z.array(CharacterSchema).min(3),
  }),
  evidence: z.array(EvidenceSchema).min(3),
  ground_truth: z.object({
    culprit_character_key: StableKeySchema,
    what_happened: z
      .string()
      .min(1)
      .describe("Canonical explanation of the objective reality of the mystery."),
    why_it_happened: z.string().min(1).describe("Canonical culprit motive."),
    explanation: z
      .string()
      .min(1)
      .describe("Canonical backend-only accusation resolution explanation."),
    suspect_truths: z.array(SuspectTruthSchema).min(1),
    timeline: z.array(TimelineEntrySchema).min(1),
  }),
}).superRefine((blueprint, ctx) => {
  const locationKeys = new Set(
    blueprint.world.locations.map((location) => location.location_key),
  );
  const characterKeys = new Set(
    blueprint.world.characters.map((character) => character.character_key),
  );
  const evidenceKeys = new Set(
    blueprint.evidence.map((evidence) => evidence.evidence_key),
  );

  for (const duplicate of uniqueKeys(
    blueprint.world.locations,
    (location) => location.location_key,
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate location_key "${duplicate}"`,
      path: ["world", "locations"],
    });
  }

  for (const duplicate of uniqueKeys(
    blueprint.world.characters,
    (character) => character.character_key,
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate character_key "${duplicate}"`,
      path: ["world", "characters"],
    });
  }

  for (const duplicate of uniqueKeys(
    blueprint.evidence,
    (evidence) => evidence.evidence_key,
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate evidence_key "${duplicate}"`,
      path: ["evidence"],
    });
  }

  for (const duplicate of uniqueKeys(
    blueprint.ground_truth.timeline,
    (entry) => entry.timeline_entry_key,
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate timeline_entry_key "${duplicate}"`,
      path: ["ground_truth", "timeline"],
    });
  }

  if (!locationKeys.has(blueprint.world.starting_location_key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "starting_location_key must reference a known world location",
      path: ["world", "starting_location_key"],
    });
  }

  for (const [index, character] of blueprint.world.characters.entries()) {
    if (!locationKeys.has(character.location_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown location_key "${character.location_key}" for character "${character.character_key}"`,
        path: ["world", "characters", index, "location_key"],
      });
    }
  }

  if (!characterKeys.has(blueprint.ground_truth.culprit_character_key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "culprit_character_key must reference a known character",
      path: ["ground_truth", "culprit_character_key"],
    });
  }

  for (const [index, evidence] of blueprint.evidence.entries()) {
    for (const relatedLocationKey of evidence.related_location_keys) {
      if (!locationKeys.has(relatedLocationKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence "${evidence.evidence_key}" references unknown location_key "${relatedLocationKey}"`,
          path: ["evidence", index, "related_location_keys"],
        });
      }
    }

    for (const relatedCharacterKey of evidence.related_character_keys) {
      if (!characterKeys.has(relatedCharacterKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence "${evidence.evidence_key}" references unknown character_key "${relatedCharacterKey}"`,
          path: ["evidence", index, "related_character_keys"],
        });
      }
    }

    for (const [pathIndex, acquisitionPath] of evidence.acquisition_paths.entries()) {
      if (
        acquisitionPath.location_key &&
        !locationKeys.has(acquisitionPath.location_key)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence "${evidence.evidence_key}" acquisition path references unknown location_key "${acquisitionPath.location_key}"`,
          path: ["evidence", index, "acquisition_paths", pathIndex, "location_key"],
        });
      }

      if (
        acquisitionPath.character_key &&
        !characterKeys.has(acquisitionPath.character_key)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence "${evidence.evidence_key}" acquisition path references unknown character_key "${acquisitionPath.character_key}"`,
          path: ["evidence", index, "acquisition_paths", pathIndex, "character_key"],
        });
      }
    }
  }

  const suspectTruthKeys = new Set<string>();
  for (const [index, truth] of blueprint.ground_truth.suspect_truths.entries()) {
    suspectTruthKeys.add(truth.character_key);
    if (!characterKeys.has(truth.character_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown character_key "${truth.character_key}" in suspect_truths`,
        path: ["ground_truth", "suspect_truths", index, "character_key"],
      });
    }

    for (const contradictionKey of truth.contradiction_evidence_keys) {
      if (!evidenceKeys.has(contradictionKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown contradiction evidence_key "${contradictionKey}"`,
          path: [
            "ground_truth",
            "suspect_truths",
            index,
            "contradiction_evidence_keys",
          ],
        });
      }
    }
  }

  if (!suspectTruthKeys.has(blueprint.ground_truth.culprit_character_key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "culprit_character_key must have a matching suspect_truth entry",
      path: ["ground_truth", "suspect_truths"],
    });
  }

  for (const [index, timelineEntry] of blueprint.ground_truth.timeline.entries()) {
    if (!locationKeys.has(timelineEntry.location_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown location_key "${timelineEntry.location_key}" in timeline`,
        path: ["ground_truth", "timeline", index, "location_key"],
      });
    }

    if (!characterKeys.has(timelineEntry.character_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown character_key "${timelineEntry.character_key}" in timeline`,
        path: ["ground_truth", "timeline", index, "character_key"],
      });
    }
  }
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
