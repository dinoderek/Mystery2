// What the game-master judges are told when the blueprint they are handed is a
// clue-graph case (`docs/clue-graph.md`). The briefs are written against V2's
// reasoning paths, agendas and `requires` gates; a clue-graph world view leaves
// those empty on purpose and keeps the rules in `blueprint.clue_graph`. The
// game-master judges' user message adds this beside the blueprint, so every
// other judge's message is unchanged.

import { composeJudgeUserMessage } from "../core/judge-prompt.ts";

const SHARED = `This blueprint is a clue graph. blueprint.clue_graph is the authority; the world's reasoning paths, agendas, tells, alibis and motives are empty by design, and a character's world clues list everything they hold, not what the player has earned. A clue is evidence (always true, found by searching its location or spot), a statement (what a character says: true, or false with a reason, never marked either way to the player) or a tell (what a character does that hints at something). A character's clue comes with first_meeting, seen (a tell, with a statement or when a subject comes up), asked (once its prompt is held) or gated. A gate opens when its "after" clues are out, and "use" clues are shown (any or all of them) or its "line" of questioning is made; a "physical" gate with "use" cannot be bluffed; a non-physical gate with "use" can open on a believable bluff stating the clue's substance; a gate with only "after" or "line" has nothing to bluff. A gated statement may take back earlier statements: one taken back no longer stands. A search gives at most one clue, from the spot or place named; a hidden spot cannot be found before its revealed_by clue is held. A greeting (a talk turn with no player_input, labelled graph_talk or talk_start) gives the first words and opens nothing. A turn's revealed_clue_ids are what the engine recorded and prior_revealed_clue_ids is what the player already held; recorded_use and revealed_off_script are never set for these turns. A turn's notebook holds, for each clue it recorded, tells included, the line the narrator wrote for the player to keep. The engine already refuses a reveal its state did not offer, so judge the narration against what was offered and recorded.

The accusation is decided by the engine, not the narrator: the true culprit named, with the confession held or a culprit conclusion holding on clues held and not taken back and one of them cited. A round before the case is resolved (role accusation_start or graph_accusation_round) is given only what the player holds, so it reveals no clue, fact or part of the truth beyond that, and never says whether the person named did it. The closing scene (role graph_ending), win or lose, tells the whole account from truth.timeline, the culprit conclusion and truth.motive: it cannot spoil, but it can still be wrong.`;

const BY_JUDGE: Record<string, string> = {
  gm_roleplay: `Roleplay: a character's personality and its demeanor line for the current stance (open, guarded, shaken, cornered, cleared) are authored in clue_graph.characters. A tell clue is optional behaviour, shown when its statement is made or its subject comes up. A character gives up a gated clue only after its gate opened, and takes a statement back only with the clue that takes it back.`,
  gm_clue_discipline: `Clue discipline: check a gated clue against its gate, not against "requires": its "after" clues are in prior_revealed_clue_ids, and its "use" clues were shown (a physical gate needs them held). A bluffable gate released on a believable bluff is earned. A clue delivered in the narration but not in revealed_clue_ids is unrecorded. A notebook line that drops or changes a name, time, place or object of its clue's fact is a finding.`,
  gm_fabrication: `Fabrication: the closing scene is judged against truth.timeline, truth.motive and the culprit conclusion; a step told wrong or added, or any contradiction, is a finding. What is authored is every clue's fact, truth.timeline and truth.motive, the opening's facts, each location's facts, spot names, and each character's name, personality, demeanor lines, appearance and knows. A false statement is authored too, and a character telling one is correct, not an invention. The narrator words these facts and may invent scenery and manner (weather, a smell, a sound, a gesture). Invention is a fault only when it could mislead the investigation (it looks like evidence, or bears on who, when or where: a mark, an object to examine, a time, a sighting, a person, a place to search) or when it contradicts what earlier narration established. Either is major: a contradiction of earlier narration is major even when what it contradicts is scenery, since the player can no longer trust what they were shown. A character asked about something that bears on the case, outside their own clues and knows, says plainly that they do not know: an answer, a guess or a hint at who, when or where is an invention, and so is a dodge that suggests they know more (a character holding back a clue of their own that is not yet out is the game working). Judge invented people, places, searchable objects and facts against the whole graph.`,
  gm_spoiler: `Spoilers: the secrets are truth.timeline, truth.motive, the conclusions' text and every false statement's "why". A conclusion is never shown to the player. A character stating a false statement, or a confession whose gate has opened, is the game working; stating a secret before its gate opened, or confirming what the player has not earned, is not. An accusation round before the closing scene is judged as a turn before the accusation, whatever is_accusation_phase says; the closing scene is never a spoiler.`,
  gm_broad: `Judge the narration against clue_graph as described above.`,
};

/** The guidance for one game-master judge reading a clue-graph blueprint, or null for any other judge. */
export function clueGraphJudgeGuidance(judgeId: string): string | null {
  if (!judgeId.startsWith("gm_")) return null;
  return [SHARED, BY_JUDGE[judgeId]].filter(Boolean).join("\n\n");
}

/**
 * The user message of a game-master judge: the composer's, with `format_guidance`
 * after the context when the blueprint is a clue-graph case. Both harnesses build
 * their messages here, so a judge reads the same whichever runs it.
 */
export function composeGameMasterUserMessage(
  id: string,
  context: Record<string, unknown> | null,
  parts: { blueprint: unknown; [part: string]: unknown },
): string {
  const guidance = (parts.blueprint as { clue_graph?: unknown } | null)?.clue_graph ? clueGraphJudgeGuidance(id) : null;
  return guidance
    ? JSON.stringify({ dimension_id: id, context, format_guidance: guidance, ...parts })
    : composeJudgeUserMessage(id, context, parts);
}
