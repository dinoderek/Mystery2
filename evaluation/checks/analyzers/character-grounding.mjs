// Character grounding analyzer (deterministic part).
//
// Heuristic: count characters of authored text per character across the
// fields a runtime GM relies on to stay grounded. If a character is below
// a minimum total, flag them as thin. The threshold is intentionally
// generous — the goal is to catch obviously starved characters; the judge
// decides whether the content is actually rich or just verbose.
//
// Fields counted (joined with newlines):
//   - background, personality, initial_attitude_towards_investigator
//   - appearance
//   - motive (if non-null), stated_alibi (if non-null)
//   - actual_actions[].summary (joined)
//   - flavor_knowledge[] (joined)
//   - clues[].text (joined) — these double as known facts in conversation
//
// Default minimum: 600 characters per character. Tune via context.min_chars.

const DEFAULT_MIN_CHARS = 600;
const DEFAULT_MIN_FLAVOR_ITEMS = 2;

export function analyze({ blueprint, context }) {
  const minChars =
    typeof context?.min_chars === "number" && context.min_chars > 0
      ? context.min_chars
      : DEFAULT_MIN_CHARS;
  const minFlavor =
    typeof context?.min_flavor_items === "number" && context.min_flavor_items >= 0
      ? context.min_flavor_items
      : DEFAULT_MIN_FLAVOR_ITEMS;

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

    const thinReasons = [];
    if (totalChars < minChars) {
      thinReasons.push(`total_grounding_chars=${totalChars} below min=${minChars}`);
    }
    if (flavorCount < minFlavor) {
      thinReasons.push(`flavor_knowledge_count=${flavorCount} below min=${minFlavor}`);
    }

    return {
      character_id: ch.id,
      first_name: ch.first_name,
      total_grounding_chars: totalChars,
      flavor_knowledge_count: flavorCount,
      passes_threshold: thinReasons.length === 0,
      thin_reasons: thinReasons,
    };
  });

  const thin = perCharacter.filter((c) => !c.passes_threshold);

  return {
    status: thin.length === 0 ? "pass" : "fail",
    details: {
      min_chars: minChars,
      min_flavor_items: minFlavor,
      per_character: perCharacter,
      thin_character_ids: thin.map((c) => c.character_id),
    },
  };
}
