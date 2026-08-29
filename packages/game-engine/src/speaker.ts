export type SpeakerKind = "investigator" | "narrator" | "character" | "system";

export interface Speaker {
  kind: SpeakerKind;
  key: string;
  label: string;
}

export const INVESTIGATOR_SPEAKER: Speaker = {
  kind: "investigator",
  key: "you",
  label: "You",
};

export const NARRATOR_SPEAKER: Speaker = {
  kind: "narrator",
  key: "narrator",
  label: "Narrator",
};

export const SYSTEM_SPEAKER: Speaker = {
  kind: "system",
  key: "system",
  label: "System",
};

function slugifyCharacterKey(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "unknown";
}

export function createCharacterSpeaker(characterName: string): Speaker {
  const label = characterName.trim() || "Character";

  return {
    kind: "character",
    key: `character:${slugifyCharacterKey(label)}`,
    label,
  };
}

export function readSpeaker(
  value: unknown,
  fallback: Speaker = NARRATOR_SPEAKER,
): Speaker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const candidate = value as {
    kind?: unknown;
    key?: unknown;
    label?: unknown;
  };

  if (
    (candidate.kind === "investigator" || candidate.kind === "narrator" ||
      candidate.kind === "character" || candidate.kind === "system") &&
    typeof candidate.key === "string" && candidate.key.length > 0 &&
    typeof candidate.label === "string" && candidate.label.length > 0
  ) {
    return {
      kind: candidate.kind,
      key: candidate.key,
      label: candidate.label,
    };
  }

  return fallback;
}
