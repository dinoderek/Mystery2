// Shared by the prompt text and the Images API `aspect_ratio` request param so
// the two can never disagree about framing.
export const DEFAULT_IMAGE_ASPECT_RATIO = "4:3";

export function slugify(value, maxLength = 48) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

export function createImageId(blueprintName, targetType, targetKey = null) {
  const prefix = slugify(blueprintName);
  const seed = targetKey ? `${targetType}-${targetKey}` : targetType;
  const target = slugify(seed, 120);
  return `${prefix}.${target}`;
}

// A case has no age of its own: any case may be played by any reader the game
// supports (6 to 11, `MIN_READING_AGE` to `MAX_READING_AGE` in age-profile.ts).
const AUDIENCE_CUE = "Audience: children aged 6 to 11. Visual complexity should be age-appropriate.";

function styleBlock(blueprint) {
  const vd = blueprint?.metadata?.visual_direction;
  if (vd) {
    const lines = [
      `Art style: ${vd.art_style}`,
      `Color palette: ${vd.color_palette}`,
      `Mood: ${vd.mood}`,
      `Lighting: ${vd.lighting}`,
    ];
    if (vd.texture) lines.push(`Texture: ${vd.texture}`);
    lines.push(AUDIENCE_CUE);
    return lines.join("\n");
  }

  return [
    "Style: storybook illustration, warm lighting, playful detective mood",
    AUDIENCE_CUE,
  ].join("\n");
}

function charactersAtLocation(blueprint, locationId) {
  return (blueprint?.world?.characters ?? []).filter(
    (character) => character.location_id === locationId,
  );
}

// Used when the blueprint does not author
// metadata.visual_direction.portrait_background.
const PORTRAIT_BACKGROUND_DEFAULT = [
  "Heavily blurred, out-of-focus wash of warm and cool tones",
  "as if photographed with a very wide aperture. Soft bokeh circles of light in amber",
  "and pale blue. The background should feel atmospheric but contain no recognizable",
  "objects, rooms, or scenery — only diffused light and color.",
].join(" ");

function portraitBackgroundHint(blueprint) {
  const custom =
    blueprint?.metadata?.visual_direction?.portrait_background?.trim();
  return `Portrait background: ${custom || PORTRAIT_BACKGROUND_DEFAULT}`;
}

function targetBlock(blueprint, target) {
  if (target.targetType === "blueprint") {
    const coverImage = blueprint.cover_image;
    const lines = [
      "Target: Mystery cover image.",
      `Title: ${blueprint.metadata.title}.`,
      `Creative direction: ${coverImage.description}`,
    ];

    if (coverImage.location_ids.length > 0) {
      const locationHints = coverImage.location_ids.map((id) => {
        const location = blueprint.world.locations.find((entry) => entry.id === id);
        return location ? `${location.name} — ${location.description}` : id;
      });
      lines.push(`Featured location(s): ${locationHints.join("; ")}`);
    }

    if (coverImage.character_ids.length > 0) {
      const characterHints = coverImage.character_ids.map((id) => {
        const character = blueprint.world.characters.find((entry) => entry.id === id);
        return character ? `${character.name} (${character.appearance})` : id;
      });
      lines.push(`Characters featured: ${characterHints.join("; ")}`);
    }

    return lines.join(" ");
  }

  if (target.targetType === "character") {
    const character = (blueprint.world?.characters ?? []).find(
      (entry) => entry.id === target.targetKey,
    );
    const displayName = character?.name ?? target.targetKey ?? "Unknown character";
    const sexCue = character?.sex ? `Sex: ${character.sex}.` : "";

    return [
      "Target: Character portrait, head-and-shoulders framing.",
      `Name: ${displayName}.`,
      sexCue,
      `Appearance: ${character?.appearance ?? ""}.`,
      `Personality cue: ${character?.personality ?? ""}.`,
      portraitBackgroundHint(blueprint),
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
          .map((c) => `${c.name} (${c.appearance})`)
          .join("; ")}.`
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

function outputBlock(aspectRatio) {
  const framing =
    aspectRatio && aspectRatio !== "auto" ? `${aspectRatio} framing, ` : "";
  return `Output: one static image, ${framing}consistent visual style.`;
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
  const aspectRatio = options.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;
  return [
    styleBlock(blueprint),
    targetBlock(blueprint, target),
    legend,
    guardrailBlock(),
    outputBlock(aspectRatio),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export { charactersAtLocation };
