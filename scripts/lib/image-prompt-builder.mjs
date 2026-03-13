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
  return [
    "Style:",
    blueprint?.metadata?.art_style?.trim() ||
      "storybook illustration, warm lighting, playful detective mood",
  ].join(" ");
}

function targetBlock(blueprint, target) {
  if (target.targetType === "blueprint") {
    return [
      "Target: Mystery cover image.",
      `Title: ${blueprint.metadata?.title ?? "Untitled mystery"}.`,
      `Premise: ${blueprint.narrative?.premise ?? ""}.`,
      `One-liner: ${blueprint.metadata?.one_liner ?? ""}.`,
    ].join(" ");
  }

  if (target.targetType === "character") {
    const character = (blueprint.world?.characters ?? []).find(
      (entry) => entry.first_name === target.targetKey,
    );
    return [
      "Target: Character portrait.",
      `Name: ${character?.first_name ?? target.targetKey ?? "Unknown character"}.`,
      `Appearance: ${character?.appearance ?? ""}.`,
      `Personality cue: ${character?.personality ?? ""}.`,
    ].join(" ");
  }

  const location = (blueprint.world?.locations ?? []).find(
    (entry) => entry.name === target.targetKey,
  );
  return [
    "Target: Location scene image.",
    `Location: ${location?.name ?? target.targetKey ?? "Unknown location"}.`,
    `Description: ${location?.description ?? ""}.`,
  ].join(" ");
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
