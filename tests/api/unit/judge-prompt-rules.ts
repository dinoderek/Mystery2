// The clue-graph rules the game-master judges' prompts state, shared by the
// tests of the prompt files (`judges-shared.test.ts`) and of what the harnesses
// send (`eval-snapshots.test.ts`).
//
// Each prompt file states the clue-graph rules it judges by
// (`docs/clue-graph.md`), naming the case's fields, and none of the retired
// format's. The preamble carries the shared model; `gm_broad` holds every rule.
export const RULES: Record<string, RegExp> = {
  "gates with after": /`after`/,
  "gates with use": /`use`/,
  "gates with a line": /`line`/,
  "physical gates": /`physical`/,
  bluffs: /bluff/i,
  tells: /\*\*tells?\*\*|`seen`/i,
  "statements taken back": /taken back|`takes_back`/,
  knows: /`knows`/,
  "notebook lines": /notebook/,
  searches: /\bsearch/i,
  "hidden spots": /`revealed_by`/,
  "the accusation rule": /`graph_accusation_round`|decides the accusation/,
  "the closing scene": /closing scene/,
};
export const EVERY_RULE = Object.keys(RULES);
export const PROMPT_RULES: Record<string, readonly string[]> = {
  "evaluation/judges/prompts/judge-system.md": EVERY_RULE,
  "evaluation/judges/gm-broad.md": EVERY_RULE,
  "evaluation/judges/gm-roleplay.md": ["gates with use", "physical gates", "bluffs", "tells", "statements taken back", "knows"],
  "evaluation/judges/gm-clue-discipline.md": [
    "gates with after",
    "gates with use",
    "gates with a line",
    "physical gates",
    "bluffs",
    "notebook lines",
    "searches",
    "hidden spots",
  ],
  "evaluation/judges/gm-fabrication.md": ["knows", "notebook lines", "searches", "the closing scene"],
  "evaluation/judges/gm-spoiler.md": ["the accusation rule", "the closing scene"],
};
export const RETIRED: readonly RegExp[] = [
  /requires/,
  /ground_truth/,
  /actual_actions/,
  /solution_paths/,
  /recorded_use/,
  /revealed_off_script/,
  /off.script/i,
  /format_guidance/,
  /agenda/i,
  /trigger/i,
  /three[- ](separate )?visits?/i,
  /stated_alibi/,
  /flavor_knowledge/,
  /is_culprit/,
  /sub_locations/,
  /initial_attitude/,
  /\bworld\.(characters|locations)/,
  /\bV2\b/i,
];
