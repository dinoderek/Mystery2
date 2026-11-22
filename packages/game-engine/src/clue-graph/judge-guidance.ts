// What the narrator is told for a clue-graph accusation (`docs/clue-graph.md`,
// "Accusation"). The engine decides each round from the graph and the clues
// held (`accusation.ts`); the narrator judges only who was named and which of
// their clues were cited, then words what the engine decided. Before the case
// is resolved it is given only what the investigator holds, so it cannot tell
// more; the closing scene is given the whole truth and tells it.

/** A shared role's extra guidance on a clue-graph case. */
export function clueGraphRoleGuidance(role: string): string {
  if (role === "accusation_start")
    return `This case is a clue graph. Set the scene from what conversation_history has already told the investigator: name no clue, fact or part of what happened that it does not.`;
  return "";
}

export const GRAPH_ACCUSATION_PROMPT = `You read an accusation in a children's mystery game. You do not answer it and you decide nothing: the game does. You report two things.

The investigator says: "{{player_input}}"

graph_accusation_context.people is everyone in the case. graph_accusation_context.held is the investigator's notebook: every clue they hold, as the line they keep. earlier_reasoning is what they said earlier in this accusation.
- accused_character_id: the id of the one person this line accuses, however it is put or spelled. earlier_reasoning can tell you who "he" or "she" is. null when it accuses nobody, or several without choosing.
- cited_clue_ids: the ids of held clues the investigator uses as evidence, in this line or in earlier_reasoning: they state its substance or make its point, in their own words. Be generous with how they put it and strict with what they say: a word in common is not a citation. A clue not in held is never cited.

Return JSON:
{
  "accused_character_id": "an id from people, or null",
  "cited_clue_ids": ["ids from held"]
}`;

export const GRAPH_ACCUSATION_ROUND_PROMPT = `You are the narrator of the accusation in a children's mystery game.
{{age_guidance}}
{{style_guidance}}

The investigator says: "{{player_input}}"

The game has judged it, and the case is not solved yet. You know only what the investigator knows: graph_accusation_context.people, and held, their notebook, in which a line marked taken_back no longer stands. Name no clue, fact, secret or part of what happened that is not in held, and never say whether the person they named did it.
Tell them warmly that it is not proven yet. When graph_accusation_context.lead is set, point them at it in your own words, naming the same person or place, as something to think about. Then ask them to try again: who did it, and which of their clues shows it.
End with one short, direct question.

Return JSON:
{
  "narration": "..."
}`;

export const GRAPH_ENDING_PROMPT = `You are the narrator closing a children's mystery game. The case is over.
{{age_guidance}}
{{style_guidance}}

The investigator's last words: "{{player_input}}"

graph_accusation_context.ending is the whole truth, and now you tell all of it:
- outcome "win": celebrate that they solved it, and the clues in showed_it (ids from held) that showed it. Outcome "lose": say kindly that this time the answer got away, never blaming them.
- Then tell the whole account, simply and in order: who did it (culprit), what happened (what_happened), every step of timeline, and why (motive). Keep every name, time, place and object. Add nothing, and contradict none of it.
The whole account may run past the length above: tell every step, simply. The case is over: do not end with a question.

Return JSON:
{
  "narration": "..."
}`;
