import { z } from "zod";

const BlueprintV2IdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Stable identifier used for authored Blueprint V2 entities.");

export const BlueprintV2CharacterSexSchema = z.enum(["male", "female"]);

export const BlueprintV2ClueRoleSchema = z
  .enum([
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
  ])
  .describe("Authored purpose of a clue inside the mystery reasoning model.");

export const BlueprintV2LocationClueSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for a location clue. Referenced by reasoning paths.",
  ),
  text: z
    .string()
    .trim()
    .min(1)
    .describe("Concrete clue text discovered by searching a location."),
  role: BlueprintV2ClueRoleSchema,
});

export const BlueprintV2CharacterClueSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for a character clue. Referenced by reasoning paths.",
  ),
  text: z
    .string()
    .trim()
    .min(1)
    .describe("Concrete mystery-relevant fact a character can reveal in conversation."),
  role: BlueprintV2ClueRoleSchema,
  about_character_id: z
    .string()
    .optional()
    .describe(
      "For alibi_knowledge, witness_testimony, motive_knowledge: which character this clue is about.",
    ),
  hint_location_id: z
    .string()
    .optional()
    .describe("For location_hint: which location this clue points to."),
});

export const BlueprintV2ReasoningPathSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for one authored reasoning path.",
  ),
  summary: z
    .string()
    .trim()
    .min(1)
    .describe("Short human-readable summary of what this path establishes."),
  description: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional extra explanation of the path for human readers."),
  location_clue_ids: z
    .array(BlueprintV2IdSchema)
    .describe("Ids of location clues that belong to this path."),
  character_clue_ids: z
    .array(BlueprintV2IdSchema)
    .describe("Ids of character clues that belong to this path."),
});

export const BlueprintV2CharacterActualActionSchema = z.object({
  sequence: z
    .number()
    .int()
    .positive()
    .describe(
      "Ordered position of this factual action within the mystery window.",
    ),
  summary: z
    .string()
    .trim()
    .min(1)
    .describe(
      "What the character was actually doing at this point in the mystery window.",
    ),
});

export const BlueprintV2CoverImageSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Creative visual description for the cover illustration, like a movie poster or book cover.",
    ),
  location_ids: z
    .array(BlueprintV2IdSchema)
    .describe(
      "Location ids featured on the cover. Empty if the cover is abstract or doesn't depict a specific location.",
    ),
  character_ids: z
    .array(BlueprintV2IdSchema)
    .describe(
      "Character ids to depict prominently on the cover.",
    ),
});

export const BlueprintV2SubLocationSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for this sub-location within a location.",
  ),
  name: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Short evocative name a child can reference, e.g. 'behind the curtains'.",
    ),
  hint: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Narrator-only guidance text used to craft hints steering the player here. Never shown directly to the player.",
    ),
  clues: z
    .array(BlueprintV2LocationClueSchema)
    .describe(
      "Clues discoverable by searching this sub-location. At most one clue per sub-location is recommended.",
    ),
});

export const BlueprintV2LocationSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for this location. Referenced by starting_location_id and character location_id.",
  ),
  name: z.string().trim().min(1),
  description: z
    .string()
    .trim()
    .min(1)
    .describe("The base description of the room when entered."),
  location_image_id: z
    .string()
    .optional()
    .describe(
      "Optional static scene image identifier shown when the investigator moves here.",
    ),
  clues: z
    .array(BlueprintV2LocationClueSchema)
    .describe("Location-level clues found by bare search. Sequential reveal."),
  sub_locations: z
    .array(BlueprintV2SubLocationSchema)
    .default([])
    .describe(
      "Searchable areas within this location. Player must describe their search to find clues here.",
    ),
});

export const BlueprintV2AgendaConditionSchema = z.enum([
  "confronted_with_evidence",
  "clever_questioning",
  "bluff",
  "trust_established",
  "pressure",
]);
export type BlueprintV2AgendaCondition = z.infer<
  typeof BlueprintV2AgendaConditionSchema
>;

export const BlueprintV2AgendaSchema = z.object({
  type: z.enum([
    "self_protect",
    "protect_other",
    "implicate_other",
    "conditional_reveal",
  ]),
  strategy: z
    .string()
    .trim()
    .min(1)
    .describe("Specific behavioral strategy from the agenda taxonomy."),
  priority: z
    .enum(["high", "medium", "low"])
    .describe("Processing order. High-priority agendas take precedence."),
  details: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Narrative guidance for the narrator AI. Describes the specific behavior, "
        + "what triggers it, and how it manifests in conversation.",
    ),
  target_character_id: z
    .string()
    .optional()
    .describe(
      "For protect_other and implicate_other: which character this agenda is about.",
    ),
  gated_clue_id: z
    .string()
    .optional()
    .describe(
      "For conditional_reveal: which clue is gated behind this agenda.",
    ),
  condition: BlueprintV2AgendaConditionSchema.optional().describe(
    "For conditional_reveal: what unlocks the gated clue.",
  ),
  yields_to_clue_ids: z
    .array(z.string())
    .optional()
    .describe(
      "For confronted_with_evidence: specific clue IDs whose content the player "
        + "must reference in conversation to break through.",
    ),
});
export type BlueprintV2Agenda = z.infer<typeof BlueprintV2AgendaSchema>;

export const BlueprintV2CharacterSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for this character. Reserved for future authored references.",
  ),
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  location_id: BlueprintV2IdSchema.describe(
    "Location id for this character's current position in the world.",
  ),
  sex: BlueprintV2CharacterSexSchema,
  appearance: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The character's appearance. Also used to generate character portraits later.",
    ),
  background: z
    .string()
    .trim()
    .min(1)
    .describe("The character's backstory and relation to the mystery."),
  personality: z
    .string()
    .trim()
    .min(1)
    .describe("The character's personality. AI should use it to impersonate them."),
  initial_attitude_towards_investigator: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The character's initial attitude toward the investigator. This shapes conversation tone.",
    ),
  stated_alibi: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      "What the character claims they were doing. This is a claim and may be false.",
    ),
  motive: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe("Why they might have done it. Null if they have no clear motive."),
  is_culprit: z.boolean().describe("Whether this character is the culprit."),
  portrait_image_id: z
    .string()
    .optional()
    .describe(
      "Optional static portrait image identifier used in talk-mode narration panels.",
    ),
  clues: z
    .array(BlueprintV2CharacterClueSchema)
    .describe("Mystery-relevant facts this character can reveal."),
  flavor_knowledge: z
    .array(z.string().trim().min(1))
    .describe(
      "Optional non-mystery worldbuilding or relationship detail. Never used as canonical mystery evidence.",
    ),
  actual_actions: z
    .array(BlueprintV2CharacterActualActionSchema)
    .min(1)
    .describe(
      "Ordered factual actions this character actually took during the mystery window.",
    ),
  agendas: z
    .array(BlueprintV2AgendaSchema)
    .default([])
    .describe(
      "Behavioral directives that shape how this character responds in conversation.",
    ),
});

function addDuplicateIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  value: string,
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: `Duplicate id "${value}" is not allowed in Blueprint V2.`,
  });
}

export const BlueprintV2Schema = z
  .object({
    schema_version: z
      .literal("v2")
      .describe("Explicit authoring schema version for Blueprint V2."),
    id: z.string().uuid(),
    metadata: z.object({
      title: z.string().trim().min(1),
      one_liner: z
        .string()
        .trim()
        .min(1)
        .describe(
          "A one-sentence summary of the mystery displayed in the selection screen.",
        ),
      target_age: z
        .number()
        .int()
        .positive()
        .describe(
          "Target age of the investigator. Used to generate age-appropriate text.",
        ),
      time_budget: z
        .number()
        .int()
        .positive()
        .describe("The number of turns the player has to solve the mystery."),
      art_style: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Legacy visual direction string. Prefer visual_direction when available.",
        ),
      visual_direction: z
        .object({
          art_style: z
            .string()
            .trim()
            .min(1)
            .describe(
              "Core rendering technique or medium (e.g. 'soft watercolor with wet-on-wet bleeds', 'gouache illustration', 'cel-shaded cartoon').",
            ),
          color_palette: z
            .string()
            .trim()
            .min(1)
            .describe(
              "3-5 dominant colors and their emotional register (e.g. 'warm autumnal — amber, rust, cream, olive').",
            ),
          mood: z
            .string()
            .trim()
            .min(1)
            .describe(
              "Emotional atmosphere in 1-2 phrases (e.g. 'cozy and whimsical with an undercurrent of suspense').",
            ),
          lighting: z
            .string()
            .trim()
            .min(1)
            .describe(
              "Primary light source and quality (e.g. 'golden hour side-lighting with long warm shadows').",
            ),
          texture: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe(
              "Surface or material quality (e.g. 'visible paper grain', 'smooth digital', 'chalky matte finish').",
            ),
        })
        .optional()
        .describe(
          "Structured visual direction for image generation. When present, takes precedence over art_style.",
        ),
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
        .trim()
        .min(1)
        .describe("The hook provided to the player when the game starts."),
      starting_knowledge: z.object({
        mystery_summary: z
          .string()
          .trim()
          .min(1)
          .describe(
            "One-liner stating what happened, approximate time, and how the time was established.",
          ),
        locations: z.array(
          z.object({
            location_id: BlueprintV2IdSchema.describe(
              "References a world.locations[].id.",
            ),
            summary: z
              .string()
              .trim()
              .min(1)
              .describe(
                "One-liner about this location from the player's perspective.",
              ),
          }),
        ),
        characters: z.array(
          z.object({
            character_id: BlueprintV2IdSchema.describe(
              "References a world.characters[].id.",
            ),
            summary: z
              .string()
              .trim()
              .min(1)
              .describe(
                "High-level who they are and their relevance to the mystery.",
              ),
          }),
        ),
      }),
    }),
    world: z.object({
      starting_location_id: BlueprintV2IdSchema.describe(
        "Location id where the investigator starts.",
      ),
      locations: z.array(BlueprintV2LocationSchema),
      characters: z.array(BlueprintV2CharacterSchema),
    }),
    cover_image: BlueprintV2CoverImageSchema,
    ground_truth: z.object({
      what_happened: z
        .string()
        .trim()
        .min(1)
        .describe("The objective reality of the crime/event."),
      why_it_happened: z
        .string()
        .trim()
        .min(1)
        .describe("The core motive of the culprit."),
      timeline: z
        .array(z.string().trim().min(1))
        .describe("Chronological sequence of events leading up to the mystery."),
    }),
    solution_paths: z
      .array(BlueprintV2ReasoningPathSchema)
      .min(1)
      .describe("Authored reasoning paths that establish the real solution."),
    red_herrings: z
      .array(BlueprintV2ReasoningPathSchema)
      .describe("Authored false-suspicion paths and how they are grounded."),
    suspect_elimination_paths: z
      .array(BlueprintV2ReasoningPathSchema)
      .describe("Authored paths used to rule out innocent suspects."),
  })
  .superRefine((value, context) => {
    const locationIds = new Set<string>();
    const subLocationIds = new Set<string>();
    const characterIds = new Set<string>();
    const locationClueIds = new Set<string>();
    const characterClueIds = new Set<string>();
    const pathIds = new Set<string>();
    const referencedClueIds = new Set<string>();

    for (const [locationIndex, location] of value.world.locations.entries()) {
      if (locationIds.has(location.id)) {
        addDuplicateIssue(context, ["world", "locations", locationIndex, "id"], location.id);
      }
      locationIds.add(location.id);

      for (const [clueIndex, clue] of location.clues.entries()) {
        if (locationClueIds.has(clue.id) || characterClueIds.has(clue.id)) {
          addDuplicateIssue(
            context,
            ["world", "locations", locationIndex, "clues", clueIndex, "id"],
            clue.id,
          );
        }
        locationClueIds.add(clue.id);
      }

      for (const [subLocIndex, subLoc] of (location.sub_locations ?? []).entries()) {
        if (subLocationIds.has(subLoc.id) || locationIds.has(subLoc.id)) {
          addDuplicateIssue(
            context,
            ["world", "locations", locationIndex, "sub_locations", subLocIndex, "id"],
            subLoc.id,
          );
        }
        subLocationIds.add(subLoc.id);

        for (const [clueIndex, clue] of subLoc.clues.entries()) {
          if (locationClueIds.has(clue.id) || characterClueIds.has(clue.id)) {
            addDuplicateIssue(
              context,
              ["world", "locations", locationIndex, "sub_locations", subLocIndex, "clues", clueIndex, "id"],
              clue.id,
            );
          }
          locationClueIds.add(clue.id);
        }
      }
    }

    if (!locationIds.has(value.world.starting_location_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["world", "starting_location_id"],
        message: "starting_location_id must reference an existing location id.",
      });
    }

    let culpritCount = 0;

    for (const [characterIndex, character] of value.world.characters.entries()) {
      if (characterIds.has(character.id)) {
        addDuplicateIssue(
          context,
          ["world", "characters", characterIndex, "id"],
          character.id,
        );
      }
      characterIds.add(character.id);

      if (!locationIds.has(character.location_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["world", "characters", characterIndex, "location_id"],
          message: "character location_id must reference an existing location id.",
        });
      }

      if (character.is_culprit) {
        culpritCount += 1;
      }

      const seenSequences = new Set<number>();
      let previousSequence = 0;
      for (const [actionIndex, action] of character.actual_actions.entries()) {
        if (seenSequences.has(action.sequence)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "world",
              "characters",
              characterIndex,
              "actual_actions",
              actionIndex,
              "sequence",
            ],
            message: "actual action sequences must be unique per character.",
          });
        }
        seenSequences.add(action.sequence);

        if (action.sequence <= previousSequence) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "world",
              "characters",
              characterIndex,
              "actual_actions",
              actionIndex,
              "sequence",
            ],
            message: "actual action sequences must be in ascending order.",
          });
        }
        previousSequence = action.sequence;
      }

      const thisCharacterClueIds = new Set<string>();
      for (const [clueIndex, clue] of character.clues.entries()) {
        if (characterClueIds.has(clue.id) || locationClueIds.has(clue.id)) {
          addDuplicateIssue(
            context,
            ["world", "characters", characterIndex, "clues", clueIndex, "id"],
            clue.id,
          );
        }
        characterClueIds.add(clue.id);
        thisCharacterClueIds.add(clue.id);
      }

      // --- Cross-character clue reference validations ---
      const crossCharRoles = ["alibi_knowledge", "witness_testimony", "motive_knowledge"];
      for (const [clueIndex, clue] of character.clues.entries()) {
        if (crossCharRoles.includes(clue.role) && !clue.about_character_id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["world", "characters", characterIndex, "clues", clueIndex, "about_character_id"],
            message: `Clue with role "${clue.role}" must have about_character_id.`,
          });
        }
        if (clue.role === "location_hint" && !clue.hint_location_id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["world", "characters", characterIndex, "clues", clueIndex, "hint_location_id"],
            message: `Clue with role "location_hint" must have hint_location_id.`,
          });
        }
      }

      // --- Agenda validations ---
      for (const [agendaIndex, agenda] of character.agendas.entries()) {
        const agendaPath = ["world", "characters", characterIndex, "agendas", agendaIndex];

        if (
          (agenda.type === "protect_other" || agenda.type === "implicate_other") &&
          !agenda.target_character_id
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...agendaPath, "target_character_id"],
            message: `Agenda type "${agenda.type}" requires target_character_id.`,
          });
        }

        if (agenda.type === "conditional_reveal") {
          if (!agenda.gated_clue_id) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...agendaPath, "gated_clue_id"],
              message: "conditional_reveal agenda requires gated_clue_id.",
            });
          } else if (!thisCharacterClueIds.has(agenda.gated_clue_id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...agendaPath, "gated_clue_id"],
              message: `gated_clue_id "${agenda.gated_clue_id}" must reference a clue in this character's clues array.`,
            });
          }

          if (!agenda.condition) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...agendaPath, "condition"],
              message: "conditional_reveal agenda requires condition.",
            });
          }

          if (agenda.condition === "confronted_with_evidence") {
            if (!agenda.yields_to_clue_ids || agenda.yields_to_clue_ids.length === 0) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...agendaPath, "yields_to_clue_ids"],
                message: "confronted_with_evidence condition requires non-empty yields_to_clue_ids.",
              });
            }
          }
        }
      }
    }

    // --- Deferred agenda reference validations (need all IDs collected) ---
    const allClueIds = new Set([...locationClueIds, ...characterClueIds]);
    for (const [characterIndex, character] of value.world.characters.entries()) {
      const thisClueIds = new Set(character.clues.map((c) => c.id));

      // Cross-character clue about_character_id must reference existing character
      for (const [clueIndex, clue] of character.clues.entries()) {
        if (clue.about_character_id && !characterIds.has(clue.about_character_id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["world", "characters", characterIndex, "clues", clueIndex, "about_character_id"],
            message: `about_character_id "${clue.about_character_id}" must reference an existing character.`,
          });
        }
        if (clue.hint_location_id && !locationIds.has(clue.hint_location_id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["world", "characters", characterIndex, "clues", clueIndex, "hint_location_id"],
            message: `hint_location_id "${clue.hint_location_id}" must reference an existing location.`,
          });
        }
      }

      for (const [agendaIndex, agenda] of character.agendas.entries()) {
        const agendaPath = ["world", "characters", characterIndex, "agendas", agendaIndex];

        // target_character_id must reference a different existing character
        if (agenda.target_character_id) {
          if (!characterIds.has(agenda.target_character_id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...agendaPath, "target_character_id"],
              message: `target_character_id "${agenda.target_character_id}" must reference an existing character.`,
            });
          } else if (agenda.target_character_id === character.id) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...agendaPath, "target_character_id"],
              message: "target_character_id must not reference the character itself.",
            });
          }
        }

        // yields_to_clue_ids must reference existing clues not in same character
        if (agenda.yields_to_clue_ids) {
          for (const [yieldIndex, clueId] of agenda.yields_to_clue_ids.entries()) {
            if (!allClueIds.has(clueId)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...agendaPath, "yields_to_clue_ids", yieldIndex],
                message: `yields_to_clue_ids references unknown clue id "${clueId}".`,
              });
            } else if (thisClueIds.has(clueId)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...agendaPath, "yields_to_clue_ids", yieldIndex],
                message: `yields_to_clue_ids must not reference clues from the same character.`,
              });
            }
          }
        }
      }
    }

    if (culpritCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["world", "characters"],
        message: "Blueprint V2 must contain exactly one culprit.",
      });
    }

    const skLocationIds = new Set<string>();
    for (const [skLocIndex, skLoc] of value.narrative.starting_knowledge.locations.entries()) {
      if (!locationIds.has(skLoc.location_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "locations", skLocIndex, "location_id"],
          message: `starting_knowledge references unknown location id "${skLoc.location_id}".`,
        });
      }
      if (skLocationIds.has(skLoc.location_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "locations", skLocIndex, "location_id"],
          message: `Duplicate location id "${skLoc.location_id}" in starting_knowledge.`,
        });
      }
      skLocationIds.add(skLoc.location_id);
    }
    for (const locId of locationIds) {
      if (!skLocationIds.has(locId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "locations"],
          message: `starting_knowledge is missing an entry for location "${locId}".`,
        });
      }
    }

    const skCharacterIds = new Set<string>();
    for (const [skCharIndex, skChar] of value.narrative.starting_knowledge.characters.entries()) {
      if (!characterIds.has(skChar.character_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "characters", skCharIndex, "character_id"],
          message: `starting_knowledge references unknown character id "${skChar.character_id}".`,
        });
      }
      if (skCharacterIds.has(skChar.character_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "characters", skCharIndex, "character_id"],
          message: `Duplicate character id "${skChar.character_id}" in starting_knowledge.`,
        });
      }
      skCharacterIds.add(skChar.character_id);
    }
    for (const charId of characterIds) {
      if (!skCharacterIds.has(charId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narrative", "starting_knowledge", "characters"],
          message: `starting_knowledge is missing an entry for character "${charId}".`,
        });
      }
    }

    for (const [locRefIndex, locId] of value.cover_image.location_ids.entries()) {
      if (!locationIds.has(locId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cover_image", "location_ids", locRefIndex],
          message: `cover_image.location_ids references unknown location id "${locId}".`,
        });
      }
    }

    for (const [charRefIndex, charId] of value.cover_image.character_ids.entries()) {
      if (!characterIds.has(charId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cover_image", "character_ids", charRefIndex],
          message: `cover_image.character_ids references unknown character id "${charId}".`,
        });
      }
    }

    const allPaths = [
      ...value.solution_paths.map((path, index) => ({
        path,
        index,
        group: "solution_paths" as const,
      })),
      ...value.red_herrings.map((path, index) => ({
        path,
        index,
        group: "red_herrings" as const,
      })),
      ...value.suspect_elimination_paths.map((path, index) => ({
        path,
        index,
        group: "suspect_elimination_paths" as const,
      })),
    ];

    for (const entry of allPaths) {
      if (pathIds.has(entry.path.id)) {
        addDuplicateIssue(context, [entry.group, entry.index, "id"], entry.path.id);
      }
      pathIds.add(entry.path.id);

      if (
        entry.path.location_clue_ids.length === 0 &&
        entry.path.character_clue_ids.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [entry.group, entry.index],
          message:
            "Each reasoning path must reference at least one location clue id or character clue id.",
        });
      }

      for (const [locationRefIndex, clueId] of entry.path.location_clue_ids.entries()) {
        if (!locationClueIds.has(clueId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entry.group, entry.index, "location_clue_ids", locationRefIndex],
            message: `Unknown location clue id "${clueId}" referenced by reasoning path.`,
          });
        } else {
          referencedClueIds.add(clueId);
        }
      }

      for (const [characterRefIndex, clueId] of entry.path.character_clue_ids.entries()) {
        if (!characterClueIds.has(clueId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entry.group, entry.index, "character_clue_ids", characterRefIndex],
            message: `Unknown character clue id "${clueId}" referenced by reasoning path.`,
          });
        } else {
          referencedClueIds.add(clueId);
        }
      }
    }

    // NOTE: Unreferenced clue checks (location and character clues not
    // referenced by any solution, red herring, or suspect elimination path)
    // are intentionally omitted from schema validation. They are enforced in
    // the softer AI-driven verification pass instead.

    for (const [locRefIndex, locId] of value.cover_image.location_ids.entries()) {
      if (!locationIds.has(locId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cover_image", "location_ids", locRefIndex],
          message: `cover_image.location_ids references unknown location id "${locId}".`,
        });
      }
    }

    for (const [charRefIndex, charId] of value.cover_image.character_ids.entries()) {
      if (!characterIds.has(charId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cover_image", "character_ids", charRefIndex],
          message: `cover_image.character_ids references unknown character id "${charId}".`,
        });
      }
    }
  });

export type BlueprintV2 = z.infer<typeof BlueprintV2Schema>;
export type BlueprintV2Character = z.infer<typeof BlueprintV2CharacterSchema>;
export type BlueprintV2Location = z.infer<typeof BlueprintV2LocationSchema>;
export type BlueprintV2SubLocation = z.infer<typeof BlueprintV2SubLocationSchema>;
export type BlueprintV2CoverImage = z.infer<typeof BlueprintV2CoverImageSchema>;
export type BlueprintV2ReasoningPath = z.infer<
  typeof BlueprintV2ReasoningPathSchema
>;
