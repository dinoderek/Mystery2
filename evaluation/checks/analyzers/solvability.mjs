// Solvability analyzer (deterministic part).
//
// The judge does the semantic work of deciding whether clues entail the
// conclusion. The analyzer does the cheap structural pre-check: at least
// one solution_path exists and each path references a positive number of
// clues that are reachable in the world (i.e., not behind a conditional
// agenda the player has no way to unlock).
//
// "Reachable" here means: every clue referenced is either a location clue
// (always discoverable by searching) or a character clue that is NOT gated
// by an agenda the player has no path to satisfy. For the walking skeleton
// we approximate "ungated" as "the clue is not in any character's
// agendas[].gated_clue_id". A more precise reachability check is a future
// extension.

export function analyze({ blueprint }) {
  const issues = [];

  if (blueprint.solution_paths.length === 0) {
    issues.push({ kind: "no_solution_paths", description: "Blueprint has zero solution_paths." });
  }

  const gatedClueIds = new Set();
  for (const ch of blueprint.world.characters) {
    for (const agenda of ch.agendas ?? []) {
      if (agenda.gated_clue_id) gatedClueIds.add(agenda.gated_clue_id);
    }
  }

  for (const path of blueprint.solution_paths) {
    const totalClues = path.location_clue_ids.length + path.character_clue_ids.length;
    if (totalClues === 0) {
      issues.push({
        kind: "empty_solution_path",
        path_id: path.id,
        description: "Solution path references no clues.",
      });
      continue;
    }
    const gatedRefs = path.character_clue_ids.filter((id) => gatedClueIds.has(id));
    if (gatedRefs.length === totalClues) {
      issues.push({
        kind: "fully_gated_solution_path",
        path_id: path.id,
        description:
          "Every clue this path references is gated behind a character agenda. Path may be unreachable.",
        gated_clue_ids: gatedRefs,
      });
    }
  }

  const hasUngatedPath = blueprint.solution_paths.some((path) => {
    const totalClues = path.location_clue_ids.length + path.character_clue_ids.length;
    if (totalClues === 0) return false;
    const gatedRefs = path.character_clue_ids.filter((id) => gatedClueIds.has(id));
    return gatedRefs.length < totalClues;
  });

  return {
    status: issues.length === 0 && hasUngatedPath ? "pass" : "fail",
    details: {
      solution_path_count: blueprint.solution_paths.length,
      has_ungated_path: hasUngatedPath,
      issues,
    },
  };
}
