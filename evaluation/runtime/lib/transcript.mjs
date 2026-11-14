// Normalized response helpers shared by backends and judges.
//
// A case evaluates ONE action, so each backend returns a single Response object.
// Every model backend produces the same shape, so judges are backend-agnostic.
//
// Response = {
//   action:          string,        // start | move | search | talk | ask | end_talk | accuse
//   request:         object,        // the body/params sent for this action (verbatim)
//   narration_parts: Array<{ text, speaker }>,
//   narration_text:  string,        // parts' text joined with "\n\n"
//   speaker:         object|null,   // first part's speaker, for convenience
//   prompt:          string|null,   // rendered runtime prompt, when the backend has it (CLI backend)
//   raw:             unknown,        // full backend/endpoint response
// }

/**
 * Pull the narration parts out of a raw endpoint response. game-start and
 * game-get nest parts under narration_events[], game-turn under events[].
 */
export function extractNarrationParts(action, data) {
  // A played turn lists the action's event first; anything after it (the
  // narration of a forced ending) is not the action under test.
  const events = Array.isArray(data?.events) ? data.events.slice(0, 1) : data?.narration_events;
  if (Array.isArray(events)) {
    return events.flatMap((event) =>
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

/**
 * Checks a game-turn answer is the turn the case's action asked for. A line
 * that played nothing (refused, a view, quit) or played another action is an
 * error: grading it would grade something other than the action under test.
 */
export function assertTurnPlayed(data, input, action) {
  if (data?.kind !== "turn") {
    const why = data?.kind === "refused" ? `: ${data.hint}` : "";
    throw new Error(`game-turn did not play "${input}" (answered ${data?.kind})${why}`);
  }
  const saved = data.events?.[0]?.event_type;
  if (!action.events.includes(saved)) {
    throw new Error(`game-turn played "${input}" as ${saved}, not as the case's action`);
  }
}
