// What the narrator is told for a clue-graph accusation (`docs/clue-graph.md`,
// "Accusation"). The engine decides each accusation from the graph and the clues
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

graph_accusation_context.people is everyone in the case. graph_accusation_context.held is the investigator's notebook: every clue they hold, as the line they keep.
- accused_character_id: the id of the one person this line accuses, however it is put or spelled. null when it accuses nobody, or several without choosing.
- cited_clue_ids: the ids of held clues the investigator uses as evidence in this line: they state its substance or make its point, in their own words. Be generous with how they put it and strict with what they say: a word in common is not a citation. A clue not in held is never cited.

Return JSON:
{
  "accused_character_id": "an id from people, or null",
  "cited_clue_ids": ["ids from held"]
}`;

export const GRAPH_ACCUSATION_ROUND_PROMPT = `You are the narrator of the accusation in a children's mystery game.
{{age_guidance}}
{{style_guidance}}

The investigator says: "{{player_input}}"

The case is not proven. graph_accusation_context carries the reported accused (an id in people, or null), held (only the clues cited), and reply (the engine's chosen explanation). Word that reply warmly; do not choose another kind.
- kind "flaw": explain the problem using cleared_by, the held clues that conflict with the accusation, or retracted, the cited statements taken back and who took them back. Give those details without declaring anyone guilty or innocent.
- kind "alternative": the cited clues also fit reply.people. Name those people, without suggesting they did it or inventing how the clues fit. The clues alone do not distinguish the accounts.
- kind "missing": what is cited is not enough. First say plainly, in simple words, the kind of fact the case still needs: reply.fact_kind. Then the lead, when it is set. Do not spend the reply retelling the cited clues. reply.fact_kind is a kind of fact, never an unseen fact to reveal.
For alternative or missing, when reply.lead is set, point toward that person or place in your own words. End with one short question about investigating further. The player can explore again; do not demand another accusation now.
When forced_by_timeout is true, whatever the kind, the turns are spent and there is no more looking: suggest nowhere to go and no one to talk to, and end by inviting them to try their accusation again.
Use only the supplied reply and cited clues. Never identify the culprit, confirm or deny the accused name, or invent a clue, explanation or alternative person. No right-name hint: every missing reply reads the same way.

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
