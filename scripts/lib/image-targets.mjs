function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveImageTargets(blueprint, options = {}) {
  const scope = options.scope ?? "all";
  const characterKeys = new Set((options.characterKeys ?? []).map(normalizeKey));
  const locationKeys = new Set((options.locationKeys ?? []).map(normalizeKey));
  const includeBlueprint =
    scope === "all" || scope === "blueprint" || scope === "selected";
  const includeCharacters =
    scope === "all" || scope === "characters" || scope === "selected";
  const includeLocations =
    scope === "all" || scope === "locations" || scope === "selected";

  const targets = [];
  if (includeBlueprint) {
    targets.push({ targetType: "blueprint", targetKey: null });
  }

  if (includeCharacters) {
    for (const character of blueprint?.world?.characters ?? []) {
      const key = normalizeKey(character.character_key);
      if (scope === "all" || characterKeys.size === 0 || characterKeys.has(key)) {
        targets.push({ targetType: "character", targetKey: character.character_key });
      }
    }
  }

  if (includeLocations) {
    for (const location of blueprint?.world?.locations ?? []) {
      const key = normalizeKey(location.location_key);
      if (scope === "all" || locationKeys.size === 0 || locationKeys.has(key)) {
        targets.push({ targetType: "location", targetKey: location.location_key });
      }
    }
  }

  return targets;
}
