import {
  BlueprintSchema,
  type Blueprint,
  type Character,
  type Evidence,
  type Location,
} from "./blueprint-schema.ts";

type StorageClient = {
  storage: {
    from: (bucket: "blueprints") => {
      download: (
        path: string,
      ) => Promise<{ data: Blob | null; error: unknown }>;
      list?: () => Promise<{
        data: Array<{ name: string }> | null;
        error: unknown;
      }>;
    };
  };
};

export class UnsupportedSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSessionStateError";
  }
}

export type ImagePurpose =
  | "blueprint_cover"
  | "location_scene"
  | "character_portrait";

export interface BlueprintRuntime {
  blueprint: Blueprint;
}

export function createBlueprintRuntime(blueprint: Blueprint): BlueprintRuntime {
  return { blueprint };
}

export function getCharacterDisplayName(
  character: Pick<Character, "first_name" | "last_name">,
): string {
  return `${character.first_name} ${character.last_name}`.trim();
}

export function getLocationByKey(
  blueprint: Blueprint,
  locationKey: string | null | undefined,
): Location | null {
  if (!locationKey) {
    return null;
  }
  return blueprint.world.locations.find((location) =>
    location.location_key === locationKey
  ) ?? null;
}

export function getLocationByName(
  blueprint: Blueprint,
  locationName: string | null | undefined,
): Location | null {
  if (!locationName) {
    return null;
  }
  const normalized = locationName.trim().toLowerCase();
  return blueprint.world.locations.find((location) =>
    location.name.trim().toLowerCase() === normalized
  ) ?? null;
}

export function getCharacterByKey(
  blueprint: Blueprint,
  characterKey: string | null | undefined,
): Character | null {
  if (!characterKey) {
    return null;
  }
  return blueprint.world.characters.find((character) =>
    character.character_key === characterKey
  ) ?? null;
}

export function getCharacterByName(
  blueprint: Blueprint,
  characterName: string | null | undefined,
  location:
    | string
    | null
    | undefined
    | { locationKey?: string | null } = undefined,
): Character | null {
  if (!characterName) {
    return null;
  }
  const locationKey = typeof location === "string" || location == null
    ? location
    : location.locationKey;
  const normalized = characterName.trim().toLowerCase();
  return blueprint.world.characters.find((character) => {
    if (locationKey && character.location_key !== locationKey) {
      return false;
    }

    const fullName = getCharacterDisplayName(character).toLowerCase();
    return (
      character.first_name.toLowerCase() === normalized ||
      fullName === normalized
    );
  }) ?? null;
}

export const findCharacterByName = getCharacterByName;
export const findLocationByName = getLocationByName;

export function getStartingLocation(blueprint: Blueprint): Location {
  const location = getLocationByKey(blueprint, blueprint.world.starting_location_key);
  if (!location) {
    throw new Error("Blueprint starting_location_key is invalid");
  }
  return location;
}

export function getVisibleCharacters(
  blueprint: Blueprint,
  locationKey: string,
): Character[] {
  return blueprint.world.characters.filter((character) =>
    character.location_key === locationKey
  );
}

export function buildPublicLocations(
  blueprint: Blueprint,
): Array<{ name: string }> {
  return blueprint.world.locations.map((location) => ({ name: location.name }));
}

export function buildPublicCharacters(
  blueprint: Blueprint,
): Array<{ first_name: string; last_name: string; location_name: string }> {
  return blueprint.world.characters.map((character) => ({
    first_name: character.first_name,
    last_name: character.last_name,
    location_name:
      getLocationByKey(blueprint, character.location_key)?.name ??
      character.location_key,
  }));
}

export function buildPublicWorld(runtime: BlueprintRuntime): {
  locations: Array<{ name: string }>;
  characters: Array<{ first_name: string; last_name: string; location_name: string }>;
} {
  return {
    locations: buildPublicLocations(runtime.blueprint),
    characters: buildPublicCharacters(runtime.blueprint),
  };
}

export function getEvidenceForSurface(
  blueprint: Blueprint,
  surface: "start" | "move" | "search" | "talk",
  options: {
    location_key?: string | null;
    character_key?: string | null;
  } = {},
): Evidence[] {
  return blueprint.evidence.filter((evidence) =>
    evidence.acquisition_paths.some((path) => {
      if (path.surface !== surface) {
        return false;
      }

      if (
        path.location_key &&
        (!options.location_key || path.location_key !== options.location_key)
      ) {
        return false;
      }

      if (
        path.character_key &&
        (!options.character_key || path.character_key !== options.character_key)
      ) {
        return false;
      }

      return true;
    })
  );
}

export function getEvidenceSummary(
  blueprint: Blueprint,
  surface: "start" | "move" | "search" | "talk",
  options: {
    location_key?: string | null;
    character_key?: string | null;
  } = {},
): Array<{ evidence_key: string; player_text: string; essential: boolean }> {
  return getEvidenceForSurface(blueprint, surface, options).map((evidence) => ({
    evidence_key: evidence.evidence_key,
    player_text: evidence.player_text,
    essential: evidence.essential,
  }));
}

export function isBlueprintImageReferenced(
  blueprint: Blueprint,
  purpose: ImagePurpose,
  imageId: string,
): boolean {
  if (purpose === "blueprint_cover") {
    return blueprint.metadata.image_id === imageId;
  }

  if (purpose === "location_scene") {
    return blueprint.world.locations.some((location) =>
      location.location_image_id === imageId
    );
  }

  return blueprint.world.characters.some((character) =>
    character.portrait_image_id === imageId
  );
}

export function isImageReferenced(
  runtime: BlueprintRuntime,
  purpose: ImagePurpose,
  imageId: string,
): boolean {
  return isBlueprintImageReferenced(runtime.blueprint, purpose, imageId);
}

export function requireLocation(
  runtime: BlueprintRuntime,
  locationKey: string,
): Location {
  const location = getLocationByKey(runtime.blueprint, locationKey);
  if (!location) {
    throw new UnsupportedSessionStateError(
      `Unsupported stale session data: current_location_id "${locationKey}" no longer resolves`,
    );
  }
  return location;
}

export function requireCharacter(
  runtime: BlueprintRuntime,
  characterKey: string,
): Character {
  const character = getCharacterByKey(runtime.blueprint, characterKey);
  if (!character) {
    throw new UnsupportedSessionStateError(
      `Unsupported stale session data: current_talk_character_id "${characterKey}" no longer resolves`,
    );
  }
  return character;
}

export function listVisibleCharacters(
  runtime: BlueprintRuntime,
  locationKey: string,
): Array<{ first_name: string; last_name: string }> {
  return getVisibleCharacters(runtime.blueprint, locationKey).map((character) => ({
    first_name: character.first_name,
    last_name: character.last_name,
  }));
}

export function loadStoredLocationName(
  runtime: BlueprintRuntime,
  storedLocationKey: string,
): string {
  return requireLocation(runtime, storedLocationKey).name;
}

export function loadStoredCharacterName(
  runtime: BlueprintRuntime,
  storedCharacterKey: string | null,
): string | null {
  if (!storedCharacterKey) {
    return null;
  }
  return requireCharacter(runtime, storedCharacterKey).first_name;
}

export async function loadBlueprintFromStorage(
  storageClient: StorageClient,
  blueprintId: string,
): Promise<Blueprint | null> {
  const { data, error } = await storageClient.storage
    .from("blueprints")
    .download(`${blueprintId}.json`);

  if (error || !data) {
    return null;
  }

  return BlueprintSchema.parse(JSON.parse(await data.text()));
}

export async function loadBlueprintRuntime(
  storageClient: StorageClient,
  blueprintId: string,
): Promise<BlueprintRuntime | null> {
  const blueprint = await loadBlueprintFromStorage(storageClient, blueprintId);
  return blueprint ? createBlueprintRuntime(blueprint) : null;
}

export async function listBlueprintsFromStorage(
  storageClient: StorageClient,
): Promise<Blueprint[]> {
  const bucket = storageClient.storage.from("blueprints");
  if (typeof bucket.list !== "function") {
    throw new Error("Storage client does not support listing blueprints");
  }

  const { data: files, error } = await bucket.list();
  if (error) {
    throw new Error("Failed to access blueprints");
  }

  const blueprints: Blueprint[] = [];
  for (const file of files ?? []) {
    if (!file.name.endsWith(".json")) {
      continue;
    }

    const blueprint = await loadBlueprintFromStorage(
      storageClient,
      file.name.replace(/\.json$/u, ""),
    );
    if (blueprint) {
      blueprints.push(blueprint);
    }
  }

  return blueprints;
}

export async function loadBlueprintSummaries(
  storageClient: StorageClient,
): Promise<Map<string, { title: string; image_id: string | null }>> {
  const summaries = new Map<string, { title: string; image_id: string | null }>();

  for (const blueprint of await listBlueprintsFromStorage(storageClient)) {
    summaries.set(blueprint.id, {
      title: blueprint.metadata.title,
      image_id: blueprint.metadata.image_id ?? null,
    });
  }

  return summaries;
}
