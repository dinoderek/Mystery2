import {
  NARRATOR_SPEAKER,
  readSpeaker,
  type Speaker,
} from "./speaker.ts";
import type { LogWriter } from "./logging.ts";

export interface NarrationPart {
  text: string;
  speaker: Speaker;
  image_id?: string | null;
}

export interface NarrationEventRecord {
  sequence: number;
  event_type: string;
  narration_parts: NarrationPart[];
  payload?: Record<string, unknown> | null;
  created_at?: string;
}

export interface FlattenedNarrationLine extends NarrationPart {
  sequence: number;
  event_type: string;
}

export interface NarrationDiagnostics {
  action: string;
  event_category: string;
  mode: string;
  resulting_mode: string;
  time_before: number | null;
  time_after: number | null;
  time_consumed: boolean;
  forced_endgame: boolean;
  trigger: string | null;
  related_sequence?: number | null;
}

interface InsertNarrationEventInput {
  session_id: string;
  event_type: string;
  actor: string;
  narration_parts: NarrationPart[];
  payload?: Record<string, unknown> | null;
  diagnostics?: NarrationDiagnostics;
  logger?: LogWriter;
}

interface DatabaseClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{ data: Array<{ sequence: number }> | null }>;
        };
      };
    };
    insert: (
      values: Record<string, unknown> | Array<Record<string, unknown>>,
    ) => Promise<{ error?: { message?: string } | null }>;
  };
}

interface EventRow {
  sequence: unknown;
  event_type: unknown;
  narration: unknown;
  narration_parts: unknown;
  payload: unknown;
  created_at?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readImageIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(payload.image_id) ??
    readString(payload.location_image_id) ??
    readString(payload.character_portrait_image_id) ??
    readString(payload.blueprint_image_id);
}

function fallbackSpeakerForEvent(row: EventRow): Speaker {
  if (row.event_type === "ask" && isRecord(row.payload)) {
    const characterName = readString(row.payload.character_name) ??
      readString(row.payload.character);
    if (characterName) {
      return {
        kind: "character",
        key: `character:${characterName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: characterName,
      };
    }
  }

  return NARRATOR_SPEAKER;
}

export function createNarrationPart(
  text: string,
  speaker: Speaker,
  imageId?: string | null,
): NarrationPart {
  return {
    text,
    speaker,
    ...(imageId ? { image_id: imageId } : {}),
  };
}

export function createNarrationDiagnostics(
  diagnostics: NarrationDiagnostics,
): NarrationDiagnostics {
  return {
    ...diagnostics,
    trigger: diagnostics.trigger ?? null,
    related_sequence: diagnostics.related_sequence ?? null,
  };
}

export function narrationTextFromParts(narrationParts: NarrationPart[]): string {
  return narrationParts.map((part) => part.text.trim()).filter(Boolean).join("\n\n");
}

export function parseNarrationParts(
  value: unknown,
  fallback: {
    narration?: string | null;
    speaker?: Speaker;
    image_id?: string | null;
  } = {},
): NarrationPart[] {
  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => {
        const text = readString(entry.text);
        if (!text) {
          return null;
        }

        return createNarrationPart(
          text,
          readSpeaker(entry.speaker, fallback.speaker ?? NARRATOR_SPEAKER),
          readString(entry.image_id) ?? null,
        );
      })
      .filter((entry): entry is NarrationPart => entry !== null);

    if (parts.length > 0) {
      return parts;
    }
  }

  const fallbackText = readString(fallback.narration);
  if (!fallbackText) {
    return [];
  }

  return [
    createNarrationPart(
      fallbackText,
      fallback.speaker ?? NARRATOR_SPEAKER,
      fallback.image_id ?? null,
    ),
  ];
}

export function readNarrationEvent(row: EventRow): NarrationEventRecord {
  const speaker = isRecord(row.payload)
    ? readSpeaker(row.payload.speaker, fallbackSpeakerForEvent(row))
    : fallbackSpeakerForEvent(row);
  const narration = readString(row.narration);

  return {
    sequence: typeof row.sequence === "number" ? row.sequence : 0,
    event_type: readString(row.event_type) ?? "event",
    narration_parts: parseNarrationParts(row.narration_parts, {
      narration,
      speaker,
      image_id: readImageIdFromPayload(row.payload),
    }),
    payload: isRecord(row.payload) ? row.payload : null,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

export function flattenNarrationEvents(
  narrationEvents: NarrationEventRecord[],
): FlattenedNarrationLine[] {
  return narrationEvents.flatMap((event) =>
    event.narration_parts.map((part) => ({
      sequence: event.sequence,
      event_type: event.event_type,
      text: part.text,
      speaker: part.speaker,
      image_id: part.image_id ?? null,
    }))
  );
}

export async function getNextNarrationSequence(
  db: DatabaseClient,
  gameId: string,
): Promise<number> {
  const { data } = await db
    .from("game_events")
    .select("sequence")
    .eq("session_id", gameId)
    .order("sequence", { ascending: false })
    .limit(1);

  return data && data.length > 0 ? data[0].sequence + 1 : 1;
}

export async function insertNarrationEvent(
  db: DatabaseClient,
  input: InsertNarrationEventInput,
): Promise<number> {
  const sequence = await getNextNarrationSequence(db, input.session_id);
  const narration = narrationTextFromParts(input.narration_parts);
  const payload = input.payload ? { ...input.payload } : {};

  if (input.diagnostics) {
    payload.diagnostics = {
      session_id: input.session_id,
      sequence,
      event_type: input.event_type,
      part_count: input.narration_parts.length,
      ...createNarrationDiagnostics(input.diagnostics),
    };
  }

  const { error } = await db.from("game_events").insert({
    session_id: input.session_id,
    sequence,
    event_type: input.event_type,
    actor: input.actor,
    payload: Object.keys(payload).length > 0 ? payload : null,
    narration,
    narration_parts: input.narration_parts,
  });

  if (error) {
    input.logger?.logError("narration_event.persist_failed", {
      session_id: input.session_id,
      event_type: input.event_type,
      sequence,
      error: error.message ?? "Failed to insert narration event",
    });
    throw new Error(error.message ?? "Failed to insert narration event");
  }

  input.logger?.log("narration_event.persisted", {
    session_id: input.session_id,
    event_type: input.event_type,
    sequence,
    part_count: input.narration_parts.length,
    ...(input.diagnostics ? createNarrationDiagnostics(input.diagnostics) : {}),
  });

  return sequence;
}

export async function insertNarrationEvents(
  db: DatabaseClient,
  sessionId: string,
  events: Array<Omit<InsertNarrationEventInput, "session_id">>,
): Promise<number[]> {
  const sequences: number[] = [];

  for (const event of events) {
    sequences.push(
      await insertNarrationEvent(db, {
        session_id: sessionId,
        ...event,
      }),
    );
  }

  return sequences;
}
