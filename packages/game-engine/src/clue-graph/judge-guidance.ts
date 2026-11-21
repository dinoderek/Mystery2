// What a shared narrator role is told about a clue-graph case. Talk and search
// have prompts of their own (`prompts.ts`); the accusation judge reads the graph.

export function clueGraphRoleGuidance(role: string): string {
  if (role === "accusation_judge")
    return `This case is a clue graph. full_blueprint.clue_graph is the authority for the clues, the gates, the statements taken back and the AND/OR conclusions; the world's legacy reasoning-path arrays are deliberately empty. clue_graph_progress is derived from the events: supported_conclusions hold over clues the investigator holds and has not had taken back. A statement is only what a character said; one taken back no longer stands. A supported conclusion alone never wins. Judge the investigator's actual explanation: require the true culprit plus reasoning from discovered evidence that supports a culprit conclusion, OR a correct reconstruction of culprit, what happened and why. Reject a lucky name-only guess. Keep the existing rounds and encouragement rules.`;
  return "";
}
