# Blueprint Generation Flows

Case format: [clue graph](clue-graph.md); narrator context:
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
| 1 | Character portrait | `visual_direction`, the character's `first_name`, `appearance`, `personality` | none | `portrait_image_id` |
| 2 | Location scene | `visual_direction`, the location's `name` and `description` | portraits of characters there | `location_image_id` |
| 3 | Cover | the case's `cover` facts, `visual_direction`, `metadata.title` | portraits and scenes for the `cover`'s characters and locations | `metadata.image_id` |

A missing `cover` field defaults to the opening's facts, every character and
the opening location. References not made this run are read from disk.

- A portrait's backdrop is `visual_direction.portrait_background` when set,
  otherwise a built-in bokeh wash, and never depicts a mystery location.
- References use `input_references[]` in the prompt legend’s order; past the default model's limit of 10, the first 10 go, with a warning.
- `--chat-packets` writes the same prompts and references for pasting into a
  chat.
- A case committed under `blueprints/` is never patched, so tracked file and
  untracked images cannot disagree: its images get fixed names
  (`packages/shared/src/image-ids.ts`), replacing the last ones, and the engine
  fills in any id the case does not name.

For `clue-graph/2`, portraits use appearance facts, locations public facts,
covers cover facts (else the opening's) and visual direction; artwork is optional.

Ratios are checked against OpenRouter’s list.

## 3D scenes

Scene recipes are not generated here. `packages/shared/src/scene-schema.ts`
bounds a procedural recipe's shapes, transforms and animations, rejecting
executable fields and unknown references. Manifests live in
`blueprint-scenes/<blueprint-id>.json`, the config root's winning over the repo's
(empty) one; the endpoint serves only these, and a case without one has none.

## Narration at play

Every row also receives the reader's age, `reading_age`, from the profile.

| Output | Source (role) | Case input | Other input | Attached |
|---|---|---|---|---|
| Menu line | `blueprints-list` (`one_liner`) | `metadata.title`, the first opening fact | — | — |
| Opening | `game-start` (`intro`); the notebook's Story | `opening.facts` | — | `metadata.image_id` |
| Arrival | the move action, `game-enter` (`ambience`) | The destination's name, `facts` and visible spot names; each character there's public face, `personality` and attitude | The last arrival's narration there, whether it was visited before | `location_image_id` |
| Search | the search action (`graph_search`) | The location's name, `facts` and visible spots; the clue the named spot holds, or the candidates to choose from | History at that location; the player's `search_query` | — |
| Talk | the talk and ask actions (`graph_talk`) | The character's state: first words, answers, tells, gates and what they keep back; `knows`; first-meeting appearance | History with that character; the line, and earlier lines of this conversation | `portrait_image_id` (talk) |
| Farewell | the end-talk action (`talk_end`) | Location summaries; the public roster; the character's `personality`, attitude and found clues as their notebook lines | History with that character | `location_image_id` |
| Accusation start | the accuse action (`accusation_start`), or a forced endgame | Location and timing; the public roster | All history, or none | — |
| Accusation | the accuse action (`graph_accusation`, then `graph_accusation_round` or `graph_ending`) | The people and the held clues; then the engine's reply material, or the timeline, culprit conclusion and motive | The accusation so far; the reasoning | — |

A character's **public face** is their name, `sex` and `appearance`; the rest
reaches only their own conversation, through the graph. Saved lines stand for
found clues. The engine chooses accusation verdicts and reply material
([clue graph](clue-graph.md)).

## Evaluation

Judging: `docs/evaluation-pipeline.md`.
