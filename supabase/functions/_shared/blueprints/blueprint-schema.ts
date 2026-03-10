import { z } from "npm:zod";

// This file contains definitions that are PRIVATE to the backend.
// The frontend should never see these raw schemas, as they contain the ground truth
// of the mystery (who did it, motives, true alibis, etc.)

export const CharacterSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  location: z
    .string()
    .describe(
      "The character's location. This MUST reference the name field of a location in the blueprint.",
    ),
  sex: z.enum(["male", "female"]),
  appearance: z
    .string()
    .describe(
      "The character's appearance. Their clothes, hair, complexion, etc. Will also be used to generate the character portraits.",
    ),
  background: z
    .string()
    .describe("The character's backstory and relation to the mystery"),
  personality: z
    .string()
    .describe(
      "The character's personality. AI should use it to impersonate the character.",
    ),
  initial_attitude_towards_investigator: z
    .string()
    .describe(
      "The character's initial attitude towards the investigator. This will influence how they respond to questions.",
    ),
  location_id: z.string().describe("The character's location"),
  mystery_action_real: z
    .string()
    .describe("The character actions relevant to the mystery."),
  stated_alibi: z
    .string()
    .nullable()
    .describe(
      "What the character claims they were doing. Null if they are happy to share their actual actions.",
    ),
  motive: z
    .string()
    .nullable()
    .describe("Why they might have done it. Null if they have no clear motive."),
  is_culprit: z.boolean().describe("Whether this character is the culprit."),
  knowledge: z
    .array(z.string())
    .describe("Specific facts or clues this character holds about the mystery and can reveal."),
});

export const LocationSchema = z.object({
  name: z.string(),
  description: z
    .string()
    .describe("The base description of the room when entered"),
  clues: z
    .array(z.string())
    .describe("Facts that can be discovered by searching here"),
});

export const BlueprintSchema = z.object({
  id: z.string().uuid(),
  metadata: z.object({
    title: z.string(),
    one_liner: z
      .string()
      .describe(
        "A one-sentence summary of the mystery that will be displayed in the selection screen",
      ),
    target_age: z
      .number()
      .int()
      .positive()
      .describe(
        "Target age of the investigator. Should be use to generate text appropriate for the reader's ability",
      ),
    time_budget: z
      .number()
      .int()
      .positive()
      .describe("The number of turns the player has to solve the mystery"),
  }),
  narrative: z.object({
    premise: z
      .string()
      .describe("The hook provided to the player when the game starts"),
    starting_knowledge: z
      .array(z.string())
      .describe("Facts the player knows immediately"),
  }),
  world: z.object({
    starting_location_id: z.string(),
    locations: z.array(LocationSchema),
    characters: z.array(CharacterSchema),
  }),
  ground_truth: z.object({
    what_happened: z
      .string()
      .describe("The objective reality of the crime/event"),
    why_it_happened: z.string().describe("The core motive of the culprit"),
    timeline: z
      .array(z.string())
      .describe("Chronological sequence of events leading up to the mystery"),
  }),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Location = z.infer<typeof LocationSchema>;
