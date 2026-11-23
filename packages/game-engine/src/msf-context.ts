import type { MysteryStructure } from "../../shared/src/mystery-structure-schema.ts";
import { evaluateMysteryStructure } from "../../shared/src/mystery-structure-progress.ts";

export function msfCharacterKnowledge(
  structure: MysteryStructure,
  characterId: string,
  discovered: Iterable<string>,
  usedClues: Iterable<string>,
) {
  const found = new Set(discovered);
  const character = structure.nodes[characterId];
  if (character.kind !== "character")
    throw new Error(`Expected MSF character ${characterId}`);
  const fact = (id: string) => {
    const node = structure.nodes[id];
    if (node.kind !== "fact") throw new Error(`Expected MSF fact ${id}`);
    return { id, text: node.text, truth: node.truth };
  };
  const claim = (id: string) => {
    const node = structure.nodes[id];
    if (node.kind !== "claim") throw new Error(`Expected MSF claim ${id}`);
    return {
      id,
      character_id: node.character_id,
      fact_id: node.fact_id,
      text: fact(node.fact_id).text,
      value: node.value,
    };
  };
  const withheldFacts = new Set<string>();
  const withheldClaims = new Set<string>();
  for (const clue of Object.values(structure.nodes)) {
    if (
      clue.kind !== "clue" ||
      clue.source.kind !== "talk" ||
      clue.source.character_id !== characterId ||
      clue.requires?.kind !== "physical" ||
      clue.requires.clue_ids.every((id) => found.has(id))
    )
      continue;
    clue.establishes_fact_ids.forEach((id) => withheldFacts.add(id));
    clue.reports_claim_ids.forEach((id) => withheldClaims.add(id));
  }
  const established = evaluateMysteryStructure(structure, found).known_fact_ids;
  const confronted = evaluateMysteryStructure(
    structure,
    usedClues,
  ).known_fact_ids;
  return {
    known_facts: character.knows_fact_ids
      .filter((id) => !withheldFacts.has(id))
      .map(fact),
    claims: Object.entries(structure.nodes)
      .filter(
        ([id, node]) =>
          node.kind === "claim" &&
          node.character_id === characterId &&
          !withheldClaims.has(id) &&
          !withheldFacts.has(node.fact_id),
      )
      .map(([id]) => {
        const statement = claim(id);
        return {
          ...statement,
          disproved:
            confronted.includes(statement.fact_id) &&
            fact(statement.fact_id).truth !== statement.value,
        };
      }),
    beliefs: (character.believes_claim_ids ?? [])
      .filter(
        (id) =>
          !withheldClaims.has(id) && !withheldFacts.has(claim(id).fact_id),
      )
      .map(claim),
    player_established_fact_ids: established,
  };
}

export function msfRoleGuidance(role: string): string {
  if (role.startsWith("talk"))
    return `This case uses Mystery Structure Format. The active character's msf data is authoritative: known_facts are what this character knows, claims are what they assert, beliefs may be mistaken. A false proposition's truth:false means it did NOT happen. Knowledge is not automatic disclosure. player_established_fact_ids shows possession, not confrontation. A claim is marked disproved only from evidence used on this character; the current question can earn a further concession. Maintain the character's claimed cover; concede only facts justified by evidence the player actually uses or a convincing deduction/bluff, never confidence alone. Claims heard are not proof of their content. Reveal a gated clue only after its prerequisites, or explicitly mark a justified social/knowledge bypass in revealed_off_script. Physical gates cannot be bypassed. Do not infer private knowledge about another character or improvise new mystery facts.`;
  if (role === "accusation_judge")
    return `This is a native Mystery Structure case. full_blueprint.msf.structure is the authority for events, facts, claims and AND/OR deductions. msf_progress is computed from discoveries, not the empty legacy path lists. Supported rules establish their conclusions; unresolved rules establish nothing. Discovering a claim does not establish its truth. Judge the player's actual explanation: require the true culprit plus reasoning using discovered evidence supporting a solution rule, OR a correct reconstruction of culprit, key events and motive. A supported rule alone never automatically wins. Reject a lucky name-only guess. Keep the encouragement and last-accusation rules.`;
  return "";
}
