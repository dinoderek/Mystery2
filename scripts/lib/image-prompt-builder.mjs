import crypto from "node:crypto";

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function createImageId(blueprintId, targetType, targetKey = null) {
  const seed = targetKey ? `${targetType}-${targetKey}` : targetType;
  return `${slugify(seed)}-${crypto.randomUUID()}`;
}

function styleBlock(blueprint) {
  const artStyle =
    blueprint?.metadata?.art_style?.trim() ||
    "storybook illustration, warm lighting, playful detective mood";
  const age = blueprint?.metadata?.target_age;
  const ageCue = age
    ? `Audience: children aged ${age}. Visual complexity should be age-appropriate.`
    : "";
  return [`Style: ${artStyle}`, ageCue].filter(Boolean).join("\n");
}

function startingLocation(blueprint) {
  const startId = blueprint?.world?.starting_location_id;
  if (!startId) return null;
  return (blueprint?.world?.locations ?? []).find(
    (location) => location.id === startId,
  );
}

function charactersAtLocation(blueprint, locationId) {
  return (blueprint?.world?.characters ?? []).filter(
    (character) => character.location_id === locationId,
  );
}

function portraitBackgroundHint() {
  return [
    "Portrait background: Heavily blurred, out-of-focus wash of warm and cool tones",
    "as if photographed with a very wide aperture. Soft bokeh circles of light in amber",
    "and pale blue. The background should feel atmospheric but contain no recognizable",
    "objects, rooms, or scenery — only diffused light and color.",
  ].join(" ");
}

function targetBlock(blueprint, target, _options = {}) {
  if (target.targetType === "blueprint") {
    const coverImage = blueprint.cover_image;
    if (coverImage?.description) {
      const lines = [
        "Target: Mystery cover image.",
        `Title: ${blueprint.metadata?.title ?? "Untitled mystery"}.`,
        `Creative direction: ${coverImage.description}`,
      ];

      const locationIds = coverImage.location_ids ?? [];
      if (locationIds.length > 0) {
        const locationHints = locationIds
          .map((locId) => {
            const loc = (blueprint.world?.locations ?? []).find((l) => l.id === locId);
            return loc ? `${loc.name} — ${loc.description}` : locId;
          })
          .join("; ");
        lines.push(`Featured location(s): ${locationHints}`);
      }

      const characterIds = coverImage.character_ids ?? [];
      if (characterIds.length > 0) {
        const charHints = characterIds
          .map((charId) => {
            const ch = (blueprint.world?.characters ?? []).find((c) => c.id === charId);
            return ch ? `${ch.first_name} ${ch.last_name} (${ch.appearance})` : charId;
          })
          .join("; ");
        lines.push(`Characters featured: ${charHints}`);
      }

      return lines.filter(Boolean).join(" ");
    }

    // Fallback for blueprints without cover_image (legacy).
    const start = startingLocation(blueprint);
    const settingHint = start
      ? `Setting: ${start.name} — ${start.description}`
      : "";
    return [
      "Target: Mystery cover image.",
      `Title: ${blueprint.metadata?.title ?? "Untitled mystery"}.`,
      `Premise: ${blueprint.narrative?.premise ?? ""}.`,
      `One-liner: ${blueprint.metadata?.one_liner ?? ""}.`,
      settingHint,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (target.targetType === "character") {
    const character = (blueprint.world?.characters ?? []).find(
      (entry) => entry.id === target.targetKey,
    );
    const displayName = character
      ? `${character.first_name} ${character.last_name}`.trim()
      : target.targetKey ?? "Unknown character";

    const sexCue = character?.sex ? `Sex: ${character.sex}.` : "";
    const attitudeCue = character?.initial_attitude_towards_investigator
      ? `Expression/body language cue: ${character.initial_attitude_towards_investigator}.`
      : "";
    const backgroundCue = character?.background
      ? `Background context: ${character.background}`
      : "";

    return [
      "Target: Character portrait, head-and-shoulders framing.",
      `Name: ${displayName}.`,
      sexCue,
      `Appearance: ${character?.appearance ?? ""}.`,
      attitudeCue,
      backgroundCue,
      `Personality cue: ${character?.personality ?? ""}.`,
      portraitBackgroundHint(),
    ]
      .filter(Boolean)
      .join(" ");
  }

  const location = (blueprint.world?.locations ?? []).find(
    (entry) => entry.id === target.targetKey,
  );

  const present = charactersAtLocation(
    blueprint,
    target.targetKey,
  );
  const characterHints =
    present.length > 0
      ? `Characters present: ${present
          .map((c) => `${c.first_name} (${c.appearance})`)
          .join("; ")}.`
      : "";

  const environmentalDetails = (location?.clues ?? [])
    .slice(0, 2)
    .map((clue) => clue.text)
    .join(" ");
  const detailHint = environmentalDetails
    ? `Environmental details to subtly include: ${environmentalDetails}`
    : "";

  const isStart =
    location?.id === blueprint?.world?.starting_location_id;
  const perspectiveHint = isStart
    ? "Perspective: show this location as if the viewer is arriving for the first time."
    : "";

  return [
    "Target: Location scene image.",
    `Location: ${location?.name ?? target.targetKey ?? "Unknown location"}.`,
    `Description: ${location?.description ?? ""}.`,
    characterHints,
    detailHint,
    perspectiveHint,
  ]
    .filter(Boolean)
    .join(" ");
}

function guardrailBlock() {
  return [
    "Guardrails:",
    "child-friendly tone, no gore, no text overlays, no watermarks,",
    "avoid direct culprit reveal or explicit spoilers.",
  ].join(" ");
}

function outputBlock(blueprint, target) {
  const stableSeed = `${blueprint.id}:${target.targetType}:${target.targetKey ?? "blueprint"}`;
  return `Output: one static image, 4:3 framing, consistent visual style, seed phrase "${stableSeed}".`;
}

export function buildReferenceLegend(referenceImages) {
  if (!referenceImages || referenceImages.length === 0) return "";
  const lines = referenceImages.map(
    (ref, i) => `- Image ${i + 1}: ${ref.label}`,
  );
  return [
    "Reference images (attached below in order):",
    ...lines,
    "",
    "Preserve the appearance of characters from their reference portraits faithfully.",
    "When depicting referenced locations, maintain their visual style and key features.",
  ].join("\n");
}

export function buildImagePrompt(blueprint, target, options = {}) {
  const legend = buildReferenceLegend(options.referenceImages);
  return [
    styleBlock(blueprint),
    targetBlock(blueprint, target, options),
    legend,
    guardrailBlock(),
    outputBlock(blueprint, target),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export { charactersAtLocation };
