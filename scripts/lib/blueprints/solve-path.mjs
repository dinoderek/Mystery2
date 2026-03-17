function stateKey(locationKey, searched, talked, acquired) {
  return JSON.stringify([
    locationKey,
    [...searched].sort(),
    [...talked].sort(),
    [...acquired].sort(),
  ]);
}

function collectEvidence(blueprint, surface, locationKey, characterKey = null) {
  return blueprint.evidence
    .filter((evidence) => evidence.acquisition_paths.some((path) =>
      path.surface === surface &&
      (!path.location_key || path.location_key === locationKey) &&
      (!path.character_key || path.character_key === characterKey)
    ))
    .map((evidence) => evidence.evidence_key);
}

export function calculateSolvePath(blueprint) {
  const essentialKeys = new Set(
    blueprint.evidence.filter((evidence) => evidence.essential).map((evidence) => evidence.evidence_key),
  );
  const startLocationKey = blueprint.world.starting_location_key;
  const initialAcquired = new Set(collectEvidence(blueprint, "start", startLocationKey));
  const queue = [{
    locationKey: startLocationKey,
    searched: new Set(),
    talked: new Set(),
    acquired: initialAcquired,
    cost: 0,
  }];
  const seen = new Set([
    stateKey(startLocationKey, new Set(), new Set(), initialAcquired),
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const hasAllEssential = [...essentialKeys].every((key) => current.acquired.has(key));
    if (hasAllEssential) {
      return {
        required_actions: current.cost,
        collected_evidence_keys: [...current.acquired].sort(),
      };
    }

    for (const location of blueprint.world.locations) {
      if (location.location_key === current.locationKey) continue;
      const acquired = new Set(current.acquired);
      for (const evidenceKey of collectEvidence(blueprint, "move", location.location_key)) {
        acquired.add(evidenceKey);
      }
      const next = {
        locationKey: location.location_key,
        searched: new Set(current.searched),
        talked: new Set(current.talked),
        acquired,
        cost: current.cost + 1,
      };
      const key = stateKey(next.locationKey, next.searched, next.talked, next.acquired);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }

    if (!current.searched.has(current.locationKey)) {
      const acquired = new Set(current.acquired);
      for (const evidenceKey of collectEvidence(blueprint, "search", current.locationKey)) {
        acquired.add(evidenceKey);
      }
      const searched = new Set(current.searched);
      searched.add(current.locationKey);
      const key = stateKey(current.locationKey, searched, current.talked, acquired);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({
          locationKey: current.locationKey,
          searched,
          talked: new Set(current.talked),
          acquired,
          cost: current.cost + 1,
        });
      }
    }

    for (const character of blueprint.world.characters) {
      if (character.location_key !== current.locationKey) continue;
      if (current.talked.has(character.character_key)) continue;
      const acquired = new Set(current.acquired);
      for (const evidenceKey of collectEvidence(
        blueprint,
        "talk",
        current.locationKey,
        character.character_key,
      )) {
        acquired.add(evidenceKey);
      }
      const talked = new Set(current.talked);
      talked.add(character.character_key);
      const key = stateKey(current.locationKey, current.searched, talked, acquired);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({
          locationKey: current.locationKey,
          searched: new Set(current.searched),
          talked,
          acquired,
          cost: current.cost + 1,
        });
      }
    }
  }

  return null;
}
