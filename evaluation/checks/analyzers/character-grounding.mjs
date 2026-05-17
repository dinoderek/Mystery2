// Character grounding analyzer (deterministic part).
//
// Runs ONLY when the outcome spec's dimension context provides explicit
// thresholds. With no thresholds in context, returns "skipped" — the
// analyzer does not invent defaults. If we want hard floors that always
// apply, encode them in the schema instead.
//
// Recognised context fields:
//   - min_chars         (number) minimum joined text length across
//                       grounding fields per character
//   - min_flavor_items  (number) minimum flavor_knowledge entries per
//                       character

export function analyze({ blueprint, context }) {
  const minChars =
    typeof context?.min_chars === "number" && context.min_chars > 0
      ? context.min_chars
      : null;
  const minFlavor =
    typeof context?.min_flavor_items === "number" && context.min_flavor_items >= 0
      ? context.min_flavor_items
      : null;

  if (minChars === null && minFlavor === null) {
    return {
      status: "skipped",
      details: {
        reason:
          "No min_chars or min_flavor_items in outcome spec context; analyzer does not invent defaults.",
      },
    };
  }

  const perCharacter = blueprint.world.characters.map((ch) => {
    const parts = [
      ch.appearance,
      ch.background,
      ch.personality,
      ch.initial_attitude_towards_investigator,
      ch.motive ?? "",
      ch.stated_alibi ?? "",
      ch.actual_actions.map((a) => a.summary).join("\n"),
      ch.flavor_knowledge.join("\n"),
      ch.clues.map((c) => c.text).join("\n"),
    ];
    const totalChars = parts.join("\n").length;
    const flavorCount = ch.flavor_knowledge.length;

    const failures = [];
    if (minChars !== null && totalChars < minChars) {
      failures.push(`total_grounding_chars=${totalChars} below min=${minChars}`);
    }
    if (minFlavor !== null && flavorCount < minFlavor) {
      failures.push(`flavor_knowledge_count=${flavorCount} below min=${minFlavor}`);
    }

    return {
      character_id: ch.id,
      first_name: ch.first_name,
      total_grounding_chars: totalChars,
      flavor_knowledge_count: flavorCount,
      passes: failures.length === 0,
      failures,
    };
  });

  const failing = perCharacter.filter((c) => !c.passes);

  return {
    status: failing.length === 0 ? "pass" : "fail",
    details: {
      min_chars: minChars,
      min_flavor_items: minFlavor,
      per_character: perCharacter,
      failing_character_ids: failing.map((c) => c.character_id),
    },
  };
}
