import { z } from "zod";

const BlueprintV2IdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Stable identifier used for authored Blueprint V2 entities.");

export const BlueprintV2CharacterSexSchema = z.enum(["male", "female"]);

export const BlueprintV2ClueRequiresSchema = z
  .object({
    clue_ids: z
      .array(BlueprintV2IdSchema)
      .min(1)
      .describe(
        "Ids of OTHER clues (location or character) that must already be DISCOVERED "
          + "before this clue can be revealed. At least one — omit the whole `requires` "
          + "object for an ungated clue. Validated to reference existing clues, to "
          + "exclude this clue itself, and to keep the discovery graph acyclic.",
      ),
    rationale: z
      .string()
      .trim()
      .min(1)
      .describe(
        "WHY this clue is gated, in-fiction. The narrator uses it both for flavor and "
          + "to judge whether a clever question or lucky bluff can unlock it off-script. "
          + "Make it signal whether cleverness may substitute — e.g. 'she only opens up "
          + "once you can prove you saw her at the dock' (a social gate cleverness could "
          + "bypass) vs. 'the safe physically cannot be opened without the key' (a hard "
          + "gate with no substitute).",
      ),
  })
  .describe(
    "Optional discovery gate. Absent/null means the clue is ungated and available from "
      + "the start. Gates define an implicit acyclic discovery graph whose edges point "
      + "from a clue to its prerequisites. Keep most clues ungated; gating should create "
      + "momentum, never dead-ends.",
  );

export const BlueprintV2LocationClueSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for a location clue. Referenced by reasoning paths.",
  ),
  text: z
    .string()
    .trim()
    .min(1)
    .describe("Concrete clue text discovered by searching a location."),
  requires: BlueprintV2ClueRequiresSchema.optional().nullable(),
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
  about_character_id: z
    .string()
    .optional()
    .describe(
      "Optional. If this clue concerns another character (alibi, observation, motive), the id of that character. Validated to reference an existing character.",
    ),
  hint_location_id: z
    .string()
    .optional()
    .describe(
      "Optional. If this clue points the investigator at a specific location, the id of that location. Validated to reference an existing location.",
    ),
  requires: BlueprintV2ClueRequiresSchema.optional().nullable(),
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
  payoff: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "What the player concretely gains by completing this path. For solution paths, the truth of the mystery. For red herrings, a named elimination, contradiction, or false-lead disproof. For suspect-elimination paths, the suspect who is ruled out. Optional for backwards compatibility, but every non-solution path should have one or the path_payoff judge will flag it.",
    ),
  location_clue_ids: z
    .array(BlueprintV2IdSchema)
    .describe("Ids of location clues that belong to this path."),
  character_clue_ids: z
    .array(BlueprintV2IdSchema)
    .describe("Ids of character clues that belong to this path."),
});

export const BlueprintV2CharacterActualActionSchema = z.object({
  // TODO: revisit the explicit `sequence` field. Either drop it and use
  // array order (touches generator prompt and runtime narrator), or keep
  // it and enforce 1..N density in superRefine alongside the existing
  // unique/ascending checks. See PR #78 discussion.
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

/**
 * When a character's behavioral tell surfaces. Three kinds:
 * - `always`: the tell is always present (ambient).
 * - `condition`: the tell surfaces once a free-text narrative condition is met,
 *   judged by the narrator (e.g. "the investigator accuses her of lying").
 * - `clue`: the tell surfaces once the investigator brings up the referenced
 *   clue(s) AND the character believes them — which happens when the
 *   investigator actually possesses the clue, or pulls off a convincing bluff.
 *   If the investigator neither has the clue nor bluffs convincingly, the
 *   character does not believe them and the tell stays hidden.
 */
export const BlueprintV2TellTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("always"),
  }),
  z.object({
    kind: z.literal("condition"),
    condition: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Free-text narrative condition the narrator judges (e.g. 'the "
          + "investigator brings up the missing key').",
      ),
  }),
  z.object({
    kind: z.literal("clue"),
    clue_ids: z
      .array(BlueprintV2IdSchema)
      .min(1)
      .describe(
        "Clue IDs (location or character) the investigator must bring up — and "
          + "be believed about (possession or a convincing bluff) — to surface "
          + "the tell. Validated to reference existing clues.",
      ),
  }),
]);
export type BlueprintV2TellTrigger = z.infer<typeof BlueprintV2TellTriggerSchema>;

export const BlueprintV2CharacterTellSchema = z.object({
  id: BlueprintV2IdSchema.describe(
    "Stable identifier for this tell.",
  ),
  text: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The visible behavioral cue the character leaks when this tell fires "
        + "(e.g. 'glances at the back door', 'voice tightens'). Authored so tells "
        + "are specific and intentional rather than improvised every turn.",
    ),
  trigger: BlueprintV2TellTriggerSchema.describe(
    "When this tell surfaces.",
  ),
});
export type BlueprintV2CharacterTell = z.infer<
  typeof BlueprintV2CharacterTellSchema
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
  tells: z
    .array(BlueprintV2CharacterTellSchema)
    .default([])
    .describe(
      "Behavioral cues this character leaks, each gated by a trigger so they "
        + "surface reactively (when their condition/clue fires) rather than every "
        + "turn. Defaults to [] — a character with no authored tells simply reacts "
        + "organically.",
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
        .min(1)
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
    const tellIds = new Set<string>();
    const pathIds = new Set<string>();
    const referencedClueIds = new Set<string>();
    // Discovery graph: clue id -> its prerequisite clue ids + the path to its
    // `requires` field, collected here and validated once all clue ids are known.
    const clueRequiresMap = new Map<
      string,
      { requires: string[]; path: (string | number)[] }
    >();

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
        if (clue.requires) {
          clueRequiresMap.set(clue.id, {
            requires: clue.requires.clue_ids,
            path: ["world", "locations", locationIndex, "clues", clueIndex, "requires", "clue_ids"],
          });
        }
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
          if (clue.requires) {
            clueRequiresMap.set(clue.id, {
              requires: clue.requires.clue_ids,
              path: [
                "world", "locations", locationIndex, "sub_locations", subLocIndex,
                "clues", clueIndex, "requires", "clue_ids",
              ],
            });
          }
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
        if (clue.requires) {
          clueRequiresMap.set(clue.id, {
            requires: clue.requires.clue_ids,
            path: ["world", "characters", characterIndex, "clues", clueIndex, "requires", "clue_ids"],
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

    // --- Clue discovery graph validations (need all clue ids collected) ---
    // (a) Each `requires` entry must reference an existing clue and not the clue
    //     itself. (b) The discovery graph must be acyclic. (c) Every clue used by
    //     a solution_path must be reachable from ungated roots (no locked critical
    //     path). There is no temporal ordering field, so "a clue requires a clue
    //     obtainable only after it" can only mean a cycle, caught by (b).
    for (const [clueId, { requires, path }] of clueRequiresMap) {
      for (const [depIndex, dep] of requires.entries()) {
        if (dep === clueId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, depIndex],
            message: `Clue "${clueId}" cannot require itself.`,
          });
        } else if (!allClueIds.has(dep)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, depIndex],
            message: `requires references unknown clue id "${dep}".`,
          });
        }
      }
    }

    // (b) Acyclicity via DFS coloring (0=unvisited, 1=in-stack, 2=done). Only
    //     known deps are followed so unknown-ref issues above aren't double-reported.
    const requiresOf = (id: string): string[] =>
      (clueRequiresMap.get(id)?.requires ?? []).filter(
        (dep) => dep !== id && allClueIds.has(dep),
      );
    const color = new Map<string, number>();
    const reportedCycle = new Set<string>();
    const visit = (id: string): void => {
      color.set(id, 1);
      for (const dep of requiresOf(id)) {
        const depColor = color.get(dep) ?? 0;
        if (depColor === 1) {
          if (!reportedCycle.has(dep)) {
            reportedCycle.add(dep);
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: clueRequiresMap.get(dep)?.path ?? ["world"],
              message: `Clue dependency cycle detected involving "${dep}".`,
            });
          }
        } else if (depColor === 0) {
          visit(dep);
        }
      }
      color.set(id, 2);
    };
    for (const clueId of clueRequiresMap.keys()) {
      if ((color.get(clueId) ?? 0) === 0) {
        visit(clueId);
      }
    }

    // (c) Reachability: a clue is discoverable when all its prerequisites are
    //     discoverable (fixpoint from ungated roots). Every solution_path clue
    //     must be discoverable.
    const discoverable = new Set<string>();
    for (const clueId of allClueIds) {
      if (requiresOf(clueId).length === 0) {
        discoverable.add(clueId);
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const clueId of allClueIds) {
        if (discoverable.has(clueId)) {
          continue;
        }
        if (requiresOf(clueId).every((dep) => discoverable.has(dep))) {
          discoverable.add(clueId);
          grew = true;
        }
      }
    }
    for (const [pathIndex, solutionPath] of value.solution_paths.entries()) {
      const solutionClueIds = [
        ...solutionPath.location_clue_ids,
        ...solutionPath.character_clue_ids,
      ];
      for (const clueId of solutionClueIds) {
        if (allClueIds.has(clueId) && !discoverable.has(clueId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["solution_paths", pathIndex],
            message:
              `Solution-path clue "${clueId}" is not discoverable: its requires `
              + "chain is never satisfiable from ungated clues (locked critical path).",
          });
        }
      }
    }
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

      // --- Tell validations ---
      for (const [tellIndex, tell] of character.tells.entries()) {
        const tellPath = ["world", "characters", characterIndex, "tells", tellIndex];

        if (
          tellIds.has(tell.id) ||
          allClueIds.has(tell.id) ||
          characterIds.has(tell.id) ||
          locationIds.has(tell.id)
        ) {
          addDuplicateIssue(context, [...tellPath, "id"], tell.id);
        }
        tellIds.add(tell.id);

        if (tell.trigger.kind === "clue") {
          for (const [clueIndex, clueId] of tell.trigger.clue_ids.entries()) {
            if (!allClueIds.has(clueId)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...tellPath, "trigger", "clue_ids", clueIndex],
                message: `tell trigger clue_ids references unknown clue id "${clueId}".`,
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
export type BlueprintV2ClueRequires = z.infer<
  typeof BlueprintV2ClueRequiresSchema
>;
