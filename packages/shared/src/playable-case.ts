import type { BlueprintV2 } from "./blueprint-schema-v2.ts";
import type { ClueGraphWorld } from "./clue-graph-case.ts";

export type PlayableBlueprint = BlueprintV2 & { clue_graph?: undefined };
export type PlayableCase = PlayableBlueprint | ClueGraphWorld;

/** The V2 talk and search paths never play a clue graph. */
export function v2CaseOf(playable: PlayableCase): PlayableBlueprint {
  if (playable.clue_graph) throw new Error("A clue-graph case does not play the V2 talk and search paths");
  return playable;
}

/** Clue-graph characters go by one name. */
export function lastNameOf(character: PlayableCase["world"]["characters"][number]): string {
  return "last_name" in character ? character.last_name : "";
}
