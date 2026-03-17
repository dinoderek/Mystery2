import fs from "node:fs/promises";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyImageGenerationResults(blueprint, results) {
  const next = clone(blueprint);

  for (const result of results) {
    if (result.status !== "generated" || !result.image_id) {
      continue;
    }

    if (result.target_type === "blueprint") {
      next.metadata = next.metadata ?? {};
      next.metadata.image_id = result.image_id;
      continue;
    }

    if (result.target_type === "character" && result.target_key) {
      const character = next.world?.characters?.find(
        (entry) => entry.character_key === result.target_key,
      );
      if (character) {
        character.portrait_image_id = result.image_id;
      }
      continue;
    }

    if (result.target_type === "location" && result.target_key) {
      const location = next.world?.locations?.find(
        (entry) => entry.location_key === result.target_key,
      );
      if (location) {
        location.location_image_id = result.image_id;
      }
    }
  }

  return next;
}

export async function patchBlueprintFile(blueprintPath, results) {
  const raw = await fs.readFile(blueprintPath, "utf-8");
  const blueprint = JSON.parse(raw);
  const patched = applyImageGenerationResults(blueprint, results);
  await fs.writeFile(blueprintPath, `${JSON.stringify(patched, null, 2)}\n`, "utf-8");
  return patched;
}
