# Blueprint Generation Flows

Case format: [clue graph](clue-graph.md); V2 schema:
`packages/shared/src/blueprint-schema-v2.ts`; narrator context:
`docs/ai-runtime.md`.
“Input” goes to the model; “attached” pairs with its output; sessions
store ids.

## Generating a clue-graph case

`./dev generate` writes `clue-graph/2` cases only, with the Claude agent in a
workspace, from a brief (`packages/blueprint-generator/src/clue-graph-brief.ts`).
Prompt: `packages/blueprint-generator/src/clue-graph-prompt.md`: a child's-game
check, no age guidance or validator rule; workspace validator: the mechanical
check (`evaluation/generator-harness/template/README.md`). `--repair <n>` runs
up to `n` rounds while anything fails, two by default and five at most
(`evaluation/generate/repair.ts`): the agent fixes the faults `repair.json`
quotes as data, and the check and, with `--judge`, every judge reruns on the
case alone. Round 0 is kept: it measures the prompt. `--install` copies a
passing final case to `blueprints/clue-graph/`.

## Generating images

`./dev gen-images` (`scripts/generate-blueprint-images.mjs`) calls OpenRouter's Images API
(`POST /api/v1/images`) and writes each image to `<image_id>.png`. The aspect
ratio is sent as a parameter and written into the prompt, so the two agree.

Three phases keep images consistent:

| Phase | Image | Blueprint input | References | Patched into |
|---|---|---|---|---|
| 1 | Character portrait | `visual_direction` (or legacy `art_style`), the character's `first_name`, `appearance`, `personality` | none | `portrait_image_id` |
| 2 | Location scene | `visual_direction`, the location's `name` and `description` | portraits of characters there | `location_image_id` |
| 3 | Cover | `cover_image.description`, `visual_direction`, `metadata.title` | portraits and scenes for `cover_image.character_ids` and `location_ids` | `metadata.image_id` |

- A portrait's backdrop is `visual_direction.portrait_background` when set,
  otherwise a built-in bokeh wash, and never depicts a mystery location.
- References use `input_references[]` in the prompt legend’s order. At most 16 are sent; beyond that the first 16, with a warning.
- `--chat-packets` writes the same prompts, with the references to upload in
  the same order, for pasting into a chat.

For `clue-graph/2`, portraits use appearance facts, locations public facts,
covers cover facts (else the title) and visual direction; artwork is optional.

Ratios are checked against OpenRouter’s list; support varies by model.

## 3D scenes

Scene recipes are not generated here. `packages/shared/src/scene-schema.ts`
bounds a procedural recipe's shapes, transforms and animations, rejecting
executable fields and unknown references. Manifests live in
`blueprint-scenes/<blueprint-id>.json`, the config root's winning over the repo's
(empty) one; the endpoint serves only these, and a case without one has none.

## Narration at play

Every row also receives `metadata.target_age` and `metadata.narration_style`.

| Output | Source (role) | Blueprint input | Other input | Attached |
|---|---|---|---|---|
| Opening | `game-start` | `narrative.premise` | — | `metadata.image_id` |
| Arrival | the move action, `game-enter` (`ambience`) | The destination's `name`, `description`, unhidden sub-location names; for each character there, their looks, `personality`, attitude, `always` tells, and a manner per live agenda | The last arrival's narration there, whether it was visited before | `location_image_id` |
| Search | the search action (`search_bare`, `search_targeted`) | The location's `description` and unlocked `clues`; each unhidden sub-location's `name`, `hint` and unlocked clues | History at that location; the player's `search_query` | — |
| Conversation | the talk, ask and end-talk actions (`talk_*`) | Location summaries; every character's public face; the active character's private fields — `background`, `clues`, `flavor_knowledge`, `actual_actions` (only steps safe to say), `agendas` (reactions and confession once earned), `tells`, alibi, motive, personality, attitude | History with that character, and their state; `player_known_clues` | `portrait_image_id` (start, ask) |
| Accusation start | the accuse action (`accusation_start`), or a forced endgame | Location and timing; the public roster | All history, or none | — |
| Accusation judge | the accuse action (`accusation_judge`) | The **full** blueprint, including `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths` | All history, or none; the reasoning; `last_accusation`; `player_known_clues`, `path_coverage` | — |

A character's **public face** is `first_name`, `last_name`, `sex`,
`appearance`, and their `starting_knowledge` summary. Private
fields reach only that character's own conversation.

`narrative.starting_knowledge` is never narrated: `game-start` and `game-get`
return it as the notebook's case facts (`mystery_summary`, and a `summary` per
location and character).

A clue-graph case gives facts to word, talk `knows` and first-meeting
appearance; saved lines stand for found clues. The engine chooses accusation
verdicts and reply material ([clue graph](clue-graph.md)). The
[grounding policy](ai-runtime.md#grounding-policy) governs how the narrator uses
those facts within its role.

## Evaluation

Judging: `docs/evaluation-pipeline.md`.
