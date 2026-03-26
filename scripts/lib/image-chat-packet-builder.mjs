import {
  buildImagePrompt,
  charactersAtLocation,
  createImageId,
} from "./image-prompt-builder.mjs";

function findCharacter(blueprint, characterId) {
  return (blueprint?.world?.characters ?? []).find(
    (character) => character.id === characterId,
  );
}

function findLocation(blueprint, locationId) {
  return (blueprint?.world?.locations ?? []).find(
    (location) => location.id === locationId,
  );
}

function buildCharacterReferenceLabel(blueprint, characterId) {
  const character = findCharacter(blueprint, characterId);
  if (!character) {
    return `Character portrait reference for ${characterId}`;
  }

  return `Portrait of ${character.first_name} ${character.last_name} (${character.appearance})`;
}

function buildLocationReferenceLabel(blueprint, locationId) {
  const location = findLocation(blueprint, locationId);
  if (!location) {
    return `Location scene reference for ${locationId}`;
  }

  return `Location scene - ${location.name}`;
}

export function buildImageReferenceManifest(blueprint, target) {
  if (target.targetType === "character") {
    return [];
  }

  if (target.targetType === "location") {
    return charactersAtLocation(blueprint, target.targetKey).map((character) => ({
      id: character.id,
      kind: "character_portrait",
      label: buildCharacterReferenceLabel(blueprint, character.id),
    }));
  }

  const references = [];

  for (const characterId of blueprint?.cover_image?.character_ids ?? []) {
    references.push({
      id: characterId,
      kind: "character_portrait",
      label: buildCharacterReferenceLabel(blueprint, characterId),
    });
  }

  for (const locationId of blueprint?.cover_image?.location_ids ?? []) {
    references.push({
      id: locationId,
      kind: "location_scene",
      label: buildLocationReferenceLabel(blueprint, locationId),
    });
  }

  return references;
}

export function formatImageTargetLabel(target) {
  if (target.targetType === "blueprint") {
    return "Blueprint cover image";
  }

  if (target.targetType === "character") {
    return `Character portrait (${target.targetKey})`;
  }

  return `Location scene (${target.targetKey})`;
}

export function buildImageChatPacket({
  blueprint,
  target,
  modelHint = "",
}) {
  const referenceManifest = buildImageReferenceManifest(blueprint, target);
  const prompt = buildImagePrompt(blueprint, target, {
    referenceImages: referenceManifest.map(({ label }) => ({ label })),
  });
  const recommendedImageFilename = `${createImageId(
    blueprint.metadata?.title ?? blueprint.id,
    target.targetType,
    target.targetKey,
  )}.png`;

  const uploadInstructions =
    referenceManifest.length === 0
      ? "No reference uploads are required for this packet."
      : [
          "Upload these reference images before sending the prompt, in this exact order:",
          ...referenceManifest.map(
            (reference, index) =>
              `${index + 1}. ${reference.label} [${reference.kind}] (${reference.id})`,
          ),
        ].join("\n");

  const modelHintBlock = modelHint.trim()
    ? `## Model Hint\n\n${modelHint.trim()}\n\n`
    : "";

  return `# Image Generation Packet

## Target

${formatImageTargetLabel(target)}

## Recommended Output Filename

\`${recommendedImageFilename}\`

${modelHintBlock}## Upload Checklist

${uploadInstructions}

## Reference Manifest

\`\`\`json
${JSON.stringify(referenceManifest, null, 2)}
\`\`\`

## Prompt

\`\`\`text
${prompt.trim()}
\`\`\`

## Notes

- This is a chat packet only; it does not call the image API.
- The reference manifest is descriptive. You must choose and upload the actual files manually.
- Reuse the listed upload order so the prompt legend stays aligned with the attached images.
`;
}
