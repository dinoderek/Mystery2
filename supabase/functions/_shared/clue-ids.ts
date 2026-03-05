export async function generateClueId(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `clue_${hashHex.substring(0, 8)}`;
}

export async function buildClueIndex(
  blueprint: any,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  // Starting knowledge clues
  for (const clue of blueprint.narrative?.starting_knowledge || []) {
    index.set(await generateClueId(clue), clue);
  }

  // Location clues
  for (const loc of blueprint.world?.locations || []) {
    for (const clue of loc.clues || []) {
      index.set(await generateClueId(clue), clue);
    }
  }

  // Character knowledge
  for (const char of blueprint.world?.characters || []) {
    for (const clue of char.knowledge || []) {
      index.set(await generateClueId(clue), clue);
    }
  }

  return index;
}
