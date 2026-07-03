// Extraction of the player-facing text authored in a Blueprint V2.
//
// "Player-facing" here means text that reaches the player either verbatim
// (title and one-liner in the mystery list, premise and starting-knowledge
// summaries in the in-game notebook, clue text once discovered) or
// near-verbatim as the material the narrator is told to stay close to
// (location descriptions). This matches the field list that
// renderGenerationGuidance() in packages/shared/src/age-profile.ts tells the
// generator to keep age-appropriate.
//
// Deliberately excluded: narrator-only material the model paraphrases under
// its own runtime age guidance — sub-location hints ("never shown directly to
// the player"), character backgrounds/personalities/alibis, tells,
// flavor_knowledge, actual_actions, image descriptions, and ground truth.

/**
 * Extract every player-facing string from a blueprint.
 * Returns [{ path, kind, text }] where `path` is a dotted JSON path into the
 * blueprint and `kind` groups strings for reporting.
 */
export function extractPlayerFacingText(blueprint) {
  const out = [];
  const push = (path, kind, text) => {
    if (typeof text === "string" && text.trim().length > 0) {
      out.push({ path, kind, text: text.trim() });
    }
  };

  push("metadata.title", "title", blueprint.metadata?.title);
  push("metadata.one_liner", "one_liner", blueprint.metadata?.one_liner);
  push("narrative.premise", "premise", blueprint.narrative?.premise);

  const sk = blueprint.narrative?.starting_knowledge;
  push(
    "narrative.starting_knowledge.mystery_summary",
    "notebook_summary",
    sk?.mystery_summary,
  );
  (sk?.locations ?? []).forEach((entry, i) => {
    push(
      `narrative.starting_knowledge.locations[${i}].summary`,
      "notebook_summary",
      entry?.summary,
    );
  });
  (sk?.characters ?? []).forEach((entry, i) => {
    push(
      `narrative.starting_knowledge.characters[${i}].summary`,
      "notebook_summary",
      entry?.summary,
    );
  });

  (blueprint.world?.locations ?? []).forEach((loc, i) => {
    push(
      `world.locations[${i}].description`,
      "location_description",
      loc?.description,
    );
    (loc?.clues ?? []).forEach((clue, j) => {
      push(`world.locations[${i}].clues[${j}].text`, "clue_text", clue?.text);
    });
    (loc?.sub_locations ?? []).forEach((sub, j) => {
      (sub?.clues ?? []).forEach((clue, k) => {
        push(
          `world.locations[${i}].sub_locations[${j}].clues[${k}].text`,
          "clue_text",
          clue?.text,
        );
      });
    });
  });

  (blueprint.world?.characters ?? []).forEach((ch, i) => {
    (ch?.clues ?? []).forEach((clue, j) => {
      push(`world.characters[${i}].clues[${j}].text`, "clue_text", clue?.text);
    });
  });

  return out;
}
