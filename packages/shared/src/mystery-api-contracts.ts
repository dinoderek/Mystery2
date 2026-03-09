import { z } from "zod";

export const ModeSchema = z.enum(["explore", "talk", "accuse", "ended"]);
export const SpeakerKindSchema = z.enum([
  "investigator",
  "narrator",
  "character",
  "system",
]);
export const SpeakerSchema = z.object({
  kind: SpeakerKindSchema,
  key: z.string().min(1),
  label: z.string().min(1),
});
export const OutcomeSchema = z.enum(["win", "lose"]);

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const GameSessionRequestSchema = z.object({
  game_id: z.string().uuid(),
});

export const GameTalkRequestSchema = GameSessionRequestSchema.extend({
  character_name: z.string().min(1),
});

export const GameAskRequestSchema = GameSessionRequestSchema.extend({
  player_input: z.string().min(1),
});

export const GameAccuseRequestSchema = GameSessionRequestSchema.extend({
  player_reasoning: z.string().min(1).optional(),
});

export const NarrationWithSpeakerSchema = z.object({
  narration: z.string(),
  speaker: SpeakerSchema,
  mode: z.enum(["explore", "talk", "accuse", "ended"]),
});

export const TalkStartResponseSchema = NarrationWithSpeakerSchema.extend({
  time_remaining: z.number().int(),
  mode: z.enum(["talk", "accuse"]),
  current_talk_character: z.string().nullable(),
});

export const TalkAskResponseSchema = NarrationWithSpeakerSchema.extend({
  time_remaining: z.number().int(),
  mode: z.enum(["talk", "accuse"]),
  current_talk_character: z.string().nullable(),
});

export const TalkEndResponseSchema = NarrationWithSpeakerSchema.extend({
  time_remaining: z.number().int(),
  mode: z.literal("explore"),
  current_talk_character: z.null(),
});

export const SearchResponseSchema = NarrationWithSpeakerSchema.extend({
  time_remaining: z.number().int(),
  mode: z.enum(["explore", "accuse"]),
});

export const AccuseResponseSchema = NarrationWithSpeakerSchema.extend({
  mode: z.enum(["accuse", "ended"]),
  result: OutcomeSchema.nullable().optional(),
  follow_up_prompt: z.string().nullable().optional(),
});

export const LocationSummarySchema = z.object({
  name: z.string(),
});

export const CharacterSummarySchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  location_name: z.string(),
});

export const HistoryEntrySchema = z.object({
  sequence: z.number().int(),
  event_type: z.string(),
  narration: z.string(),
  speaker: SpeakerSchema,
});

export const GameStateSchema = z.object({
  locations: z.array(LocationSummarySchema),
  characters: z.array(CharacterSummarySchema),
  time_remaining: z.number().int(),
  location: z.string(),
  mode: ModeSchema,
  current_talk_character: z.string().nullable(),
  narration: z.string(),
  narration_speaker: SpeakerSchema,
  history: z.array(HistoryEntrySchema),
});

export const GameStartResponseSchema = z.object({
  game_id: z.string().uuid(),
  state: GameStateSchema,
});

export const GameGetResponseSchema = z.object({
  state: GameStateSchema,
});

export const BlueprintSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  one_liner: z.string(),
  target_age: z.number().int().positive(),
});

export type SpeakerKind = z.infer<typeof SpeakerKindSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GameSessionRequest = z.infer<typeof GameSessionRequestSchema>;
export type GameTalkRequest = z.infer<typeof GameTalkRequestSchema>;
export type GameAskRequest = z.infer<typeof GameAskRequestSchema>;
export type GameAccuseRequest = z.infer<typeof GameAccuseRequestSchema>;
export type TalkStartResponse = z.infer<typeof TalkStartResponseSchema>;
export type TalkAskResponse = z.infer<typeof TalkAskResponseSchema>;
export type TalkEndResponse = z.infer<typeof TalkEndResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type AccuseResponse = z.infer<typeof AccuseResponseSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type GameStartResponse = z.infer<typeof GameStartResponseSchema>;
export type GameGetResponse = z.infer<typeof GameGetResponseSchema>;
export type BlueprintSummary = z.infer<typeof BlueprintSummarySchema>;
