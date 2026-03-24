import crypto from "node:crypto";

function slugify(value) {
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

function targetBlock(blueprint, target) {
  if (target.targetType === "blueprint") {
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

    const location = character?.location_id
      ? (blueprint.world?.locations ?? []).find(
          (loc) => loc.id === character.location_id,
        )
      : null;
    const backgroundHint = location
      ? `Environment: ${location.name}.`
      : "";

    const sexCue = character?.sex ? `Sex: ${character.sex}.` : "";
    const attitudeCue = character?.initial_attitude_towards_investigator
      ? `Expression/body language cue: ${character.initial_attitude_towards_investigator}.`
      : "";
    const backgroundCue = character?.background
      ? `Background context: ${character.background}`
      : "";

    return [
      "Target: Character portrait.",
      `Name: ${displayName}.`,
      sexCue,
      `Appearance: ${character?.appearance ?? ""}.`,
      attitudeCue,
      backgroundCue,
      `Personality cue: ${character?.personality ?? ""}.`,
      backgroundHint,
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

export function buildImagePrompt(blueprint, target) {
  return [
    styleBlock(blueprint),
    targetBlock(blueprint, target),
    guardrailBlock(),
    outputBlock(blueprint, target),
  ].join("\n\n");
}
