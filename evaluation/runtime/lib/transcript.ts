// Normalized response helpers shared by the narrator sources and the judges.
//
// A case evaluates ONE action, so each source returns a single Response object.
// Every source produces the same shape, so judges do not care who narrated.
//
// Response = {
//   action:          string,        // start | move | search | talk | ask | end_talk | accuse
//   request:         object,        // the body/params sent for this action (verbatim)
//   narration_parts: Array<{ text, speaker }>,
//   narration_text:  string,        // parts' text joined with "\n\n"
//   speaker:         object|null,   // first part's speaker, for convenience
//   prompt:          string|null,   // rendered runtime prompt, when the source has it (CLI narrators)
//   raw:             unknown,        // full narrator/endpoint response
// }

import type { Speaker } from "./case.ts";
import type { ActionSpec } from "./roles.ts";

export interface NarrationPart {
  text: string;
  speaker: Speaker | null;
}

/** The normalized single-action response every narrator source produces. */
export interface TurnResponse {
  action: string;
  request: Record<string, unknown>;
  narration_parts: NarrationPart[];
  narration_text: string;
  speaker: Speaker | null;
  prompt: string | null;
  raw: unknown;
}

type Loose = Record<string, unknown> | null | undefined;

/**
 * Pull the narration parts out of a raw endpoint response. game-start and
 * game-get nest parts under narration_events[], game-turn under events[].
 */
export function extractNarrationParts(action: string, data: Loose): NarrationPart[] {
  // A played turn lists the action's event first; anything after it (the
  // narration of a forced ending) is not the action under test.
  const events = Array.isArray(data?.events) ? data.events.slice(0, 1) : data?.narration_events;
  if (Array.isArray(events)) {
    return events.flatMap((event: Loose) =>
      Array.isArray(event?.narration_parts) ? (event.narration_parts as NarrationPart[]) : [],
    );
  }
  return [];
}

/** Join narration parts into a single text blob for readability scoring. */
export function partsToText(parts: ReadonlyArray<{ text?: unknown }> | null | undefined): string {
  return (parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** Build the normalized single-action Response. */
export function makeResponse({
  action,
  request,
  parts,
  prompt = null,
  raw,
}: {
  action: string;
  request?: Record<string, unknown>;
  parts?: NarrationPart[];
  prompt?: string | null;
  raw: unknown;
}): TurnResponse {
  const narrationParts = parts ?? [];
  return {
    action,
    request: request ?? {},
    narration_parts: narrationParts,
    narration_text: partsToText(narrationParts),
    speaker: narrationParts[0]?.speaker ?? null,
    prompt,
    raw,
  };
}

/**
 * Checks a game-turn answer is the turn the case's action asked for. A line
 * that played nothing (refused, a view, quit) or played another action is an
 * error: grading it would grade something other than the action under test.
 */
export function assertTurnPlayed(data: Loose, input: string, action: Pick<ActionSpec, "events">): void {
  if (data?.kind !== "turn") {
    const why = data?.kind === "refused" ? `: ${String(data.hint)}` : "";
    throw new Error(`game-turn did not play "${input}" (answered ${data?.kind})${why}`);
  }
  const saved = (data.events as Array<{ event_type?: string }> | undefined)?.[0]?.event_type;
  if (!action.events?.includes(String(saved))) {
    throw new Error(`game-turn played "${input}" as ${saved}, not as the case's action`);
  }
}
