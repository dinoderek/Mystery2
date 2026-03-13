function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveImageTargets(blueprint, options = {}) {
  const scope = options.scope ?? "all";
  const characterKeys = new Set((options.characterKeys ?? []).map(normalizeKey));
  const locationKeys = new Set((options.locationKeys ?? []).map(normalizeKey));

  const targets = [];
  if (scope === "all" || scope === "blueprint" || scope === "mixed") {
    targets.push({ targetType: "blueprint", targetKey: null });
  }

  if (scope === "all" || scope === "characters" || scope === "mixed") {
    for (const character of blueprint?.world?.characters ?? []) {
      const key = normalizeKey(character.first_name);
      if (scope === "all" || characterKeys.size === 0 || characterKeys.has(key)) {
        targets.push({ targetType: "character", targetKey: character.first_name });
      }
    }
  }

  if (scope === "all" || scope === "locations" || scope === "mixed") {
    for (const location of blueprint?.world?.locations ?? []) {
      const key = normalizeKey(location.name);
      if (scope === "all" || locationKeys.size === 0 || locationKeys.has(key)) {
        targets.push({ targetType: "location", targetKey: location.name });
      }
    }
  }

  return targets;
}
