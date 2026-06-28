// Normalized response helpers shared by backends and judges.
//
// A case evaluates ONE action, so each backend returns a single Response object.
// Every model backend produces the same shape, so judges are backend-agnostic.
//
// Response = {
//   action:          string,        // move | search | talk | ask | accuse
//   request:         object,        // the body/params sent for this action (verbatim)
//   narration_parts: Array<{ text, speaker }>,
//   narration_text:  string,        // parts' text joined with "\n\n"
//   speaker:         object|null,   // first part's speaker, for convenience
//   prompt:          string|null,   // rendered runtime prompt, when the backend has it (CLI backend)
//   raw:             unknown,        // full backend/endpoint response
// }

/**
 * Pull the narration parts out of a raw endpoint response. game-start and
 * game-get nest parts under narration_events[]; every turn endpoint returns
 * narration_parts at the top level.
 */
export function extractNarrationParts(action, data) {
  if (data && Array.isArray(data.narration_parts)) {
    return data.narration_parts;
  }
  if (data && Array.isArray(data.narration_events)) {
    return data.narration_events.flatMap((event) =>
      Array.isArray(event?.narration_parts) ? event.narration_parts : [],
    );
  }
  return [];
}

/** Join narration parts into a single text blob for readability scoring. */
export function partsToText(parts) {
  return (parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** Build the normalized single-action Response. */
export function makeResponse({ action, request, parts, prompt = null, raw }) {
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
