// Fairness analyzer (deterministic part).
//
// For every non-culprit character, check that *some*
// suspect_elimination_path either references a clue authored on that
// character, or references a clue whose role/about_character_id points at
// them. This is a necessary-but-not-sufficient check — the semantic
// question of "does the clue actually clear them" is for the judge.

export function analyze({ blueprint }) {
  const charClueOwner = new Map();
  for (const ch of blueprint.world.characters) {
    for (const clue of ch.clues) {
      charClueOwner.set(clue.id, { ownerId: ch.id, aboutId: clue.about_character_id ?? null });
    }
  }

  const elimByCharacter = new Map();
  for (const ch of blueprint.world.characters) {
    if (!ch.is_culprit) elimByCharacter.set(ch.id, []);
  }

  for (const path of blueprint.suspect_elimination_paths) {
    const referencedChars = new Set();
    for (const clueId of path.character_clue_ids) {
      const owner = charClueOwner.get(clueId);
      if (!owner) continue;
      if (elimByCharacter.has(owner.ownerId)) referencedChars.add(owner.ownerId);
      if (owner.aboutId && elimByCharacter.has(owner.aboutId)) referencedChars.add(owner.aboutId);
    }
    for (const charId of referencedChars) {
      elimByCharacter.get(charId).push(path.id);
    }
  }

  const uncleared = [];
  for (const [charId, pathIds] of elimByCharacter.entries()) {
    if (pathIds.length === 0) uncleared.push(charId);
  }

  return {
    status: uncleared.length === 0 ? "pass" : "fail",
    details: {
      non_culprit_count: elimByCharacter.size,
      uncleared_character_ids: uncleared,
      elimination_paths_per_character: Object.fromEntries(elimByCharacter),
    },
  };
}
