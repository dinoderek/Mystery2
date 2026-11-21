/**
 * Parses a JSON document, refusing a duplicate key in any object: `JSON.parse`
 * would keep the last one silently. The case-file checks share it.
 */
export function parseDocument(raw) {
  const value = JSON.parse(raw);
  const objects = [];
  for (const match of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]]/g)) {
    const token = match[0];
    if (token === "{") objects.push(new Set());
    else if (token === "[") objects.push(null);
    else if (token === "}" || token === "]") objects.pop();
    else if (
      raw
        .slice(match.index + token.length)
        .trimStart()
        .startsWith(":")
    ) {
      const key = JSON.parse(token);
      const keys = objects.at(-1);
      if (keys.has(key)) throw new Error(`Duplicate JSON key "${key}"`);
      keys.add(key);
    }
  }
  return value;
}
