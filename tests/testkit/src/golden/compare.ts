// Making a transcript comparable, and saying where two of them differ.

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g;

/**
 * Replaces what differs from one run to the next (ids a run generates,
 * timestamps) with a fixed token, so only what the player reads is compared.
 * The fixture blueprints' own ids, such as `loc-kitchen`, are kept.
 */
export function normalizeTranscript(text: string): string {
  return text
    .replace(UUID, "<id>")
    .replace(TIMESTAMP, "<time>")
    .replace(/[ \t]+$/gm, "");
}

/** Where `actual` first departs from `expected`, naming the game and the line, or null when they match. */
export function describeTranscriptDiff(game: string, expected: string, actual: string): string | null {
  if (expected === actual) return null;

  const want = expected.split("\n");
  const got = actual.split("\n");
  const length = Math.max(want.length, got.length);
  for (let index = 0; index < length; index += 1) {
    if (want[index] !== got[index]) {
      return [
        `Golden transcript "${game}" differs at line ${index + 1}:`,
        `  expected: ${want[index] ?? "(no such line)"}`,
        `  actual:   ${got[index] ?? "(no such line)"}`,
        "If the change is intended, record again (see docs/testing.md, \"Golden transcripts\").",
      ].join("\n");
    }
  }
  return null;
}
