import { z } from "zod";

const text = z.string().trim().min(1);
// IDs are not normalized: changing a map key would break its references.
const id = z
  .string()
  .min(1)
  .regex(/\S/, "ID must not be blank")
  .refine((value) => value !== "__proto__", "ID __proto__ is reserved");
const positiveInteger = z.number().int().positive().safe();

function ids(min = 0) {
  return z
    .array(id)
    .min(min)
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `Duplicate reference "${value}"`,
          });
        seen.add(value);
      });
    });
}

export const MysteryStructureNodeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("character"),
      name: text,
      location_id: id,
      knows_fact_ids: ids(),
      believes_claim_ids: ids().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("location"), name: text }).strict(),
  z.object({ kind: z.literal("object"), name: text }).strict(),
  z
    .object({
      kind: z.literal("event"),
      text,
      character_ids: ids(),
      location_id: id,
      object_ids: ids(),
      after_event_ids: ids(),
      caused_by_event_ids: ids(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fact"),
      text,
      truth: z.boolean(),
      about_ids: ids(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("claim"),
      character_id: id,
      fact_id: id,
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clue"),
      text,
      source: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("search"),
            location_id: id,
            spot: text.optional(),
          })
          .strict(),
        z.object({ kind: z.literal("talk"), character_id: id }).strict(),
      ]),
      establishes_fact_ids: ids(),
      reports_claim_ids: ids(),
      origin_event_ids: ids().optional(),
      requires: z
        .object({
          clue_ids: ids(1),
          kind: z.enum(["physical", "social", "knowledge"]),
          rationale: text,
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rule"),
      operator: z.enum(["AND", "OR"]),
      children: ids(1),
      concludes_fact_ids: ids(1),
      rationale: text,
    })
    .strict(),
]);

/** Shape validation only; validateMysteryStructure also checks graph integrity and solvability. */
export const MysteryStructureSchema = z
  .object({
    $format: z.literal("MYSTERY-STRUCTURE"),
    $specVersion: z.literal("0.1.0"),
    metadata: z
      .object({
        id,
        revision: positiveInteger,
        title: text,
        target_age: positiveInteger,
        time_budget: positiveInteger,
      })
      .strict(),
    opening: z
      .object({
        premise: text,
        starting_location_id: id,
        known_fact_ids: ids(),
      })
      .strict(),
    nodes: z.record(id, MysteryStructureNodeSchema),
    solution: z
      .object({
        culprit_id: id,
        event_ids: ids(1),
        motive_fact_id: id,
        rule_ids: ids(1),
      })
      .strict(),
    red_herrings: z.array(
      z
        .object({
          hypothesis_fact_id: id,
          lead_clue_ids: ids(1),
          resolution_rule_id: id,
          payoff: text,
        })
        .strict(),
    ),
    eliminations: z.array(
      z
        .object({
          character_id: id,
          rule_id: id,
          payoff: text,
        })
        .strict(),
    ),
  })
  .strict();

export type MysteryStructure = z.infer<typeof MysteryStructureSchema>;
export type MysteryStructureNode = z.infer<typeof MysteryStructureNodeSchema>;
