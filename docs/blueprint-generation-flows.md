# Blueprint Generation Flows

Blueprint, artwork and narration inputs. Field intent:
`packages/shared/src/blueprint-schema-v2.ts`; narrator context:
`docs/ai-runtime.md`. “Input” is sent to the model; “attached” is paired with
its output. Sessions store ids.

## Generating a blueprint

`./dev eval generate` uses `buildBlueprintGenerationChatInput` in
`packages/blueprint-generator` for both backends:

- **System:** `packages/blueprint-generator/src/generator-prompt.md` plus age
  guidance from `renderGenerationGuidance` in `packages/shared/src/age-profile.ts`.
- **User:** the brief, validated against
  `packages/blueprint-generator/src/story-brief.ts`, with schema instructions.
- **API response format:** strict JSON Schema from `BlueprintV2Schema`, less
  image ids; strict-mode nulls are removed.

The agent backend gets both in its workspace. Both save
`result.json` after the schema and mechanical checks; a rejected blueprint is
kept, never installed (`evaluation/README.md`).

### Repair rounds

`--judge --repair <n>` (agent backend) runs up to `n` rounds while anything
fails (`evaluation/generate/repair.ts`): the agent fixes, in place, the faults
`repair.json` quotes as data, and every check and judge reruns, seeing only
brief and blueprint. Round 0 is kept: its first pass measures the prompt.

<!-- extract:generator-prompt -->
What the generator prompt asks for, in short:

- A complete, solvable children's mystery, built in a fixed order: hidden
  truth, what each character actually did, solution paths, red herrings,
  suspect-elimination paths, clue placement, flavour, then a consistency
  pass.
- Text at the target age on two dials that mirror the narrator's:
  **complexity** (sentence length, vocabulary) and **length** (a per-age word
  budget for the one-liner, premise, every `starting_knowledge` summary, every
  location description and every clue). Names carry no word budget.
- Challenge sized to `timeBudget`, and a shortest solution path of at least
  `minPathLength` distinct, necessary clues, deepened if it falls short.
- Agendas (self-protection, with each breaking fact's clues and reaction,
  and a confession; protect-other, implicate-other, conditional reveal) and
  cross-character clues, with a solution path free of condition-gated clues.
- A clue discovery graph through `requires`, each lock a `pointer` or
  `leverage`: mostly ungated, acyclic, every solution clue reachable from an
  ungated root, a location lock always a pointer. The schema, the mechanical
  checks and the `clue_graph` dimension enforce it.
- Physical consistency: where an object is, what state it is in, and what a
  character looks like or carries agree across clues, `actual_actions`,
  descriptions, `appearance`, `flavor_knowledge` and summaries. Nothing the
  player sees before a clue is found — `appearance`, location descriptions,
  `starting_knowledge` — shows or contradicts that clue's evidence. The
  `knowledge_coherence` dimension judges it.
- Exactly one culprit and a consistent timeline; `cover_image` direction; no
  image ids.
<!-- /extract:generator-prompt -->

## Generating images

<!-- extract:image-generation -->
`scripts/generate-blueprint-images.mjs` calls OpenRouter's Images API
(`POST /api/v1/images`) and writes each image to `<image_id>.png`. The aspect
ratio is sent as a parameter and written into the prompt, so the two agree.

It runs in three phases so later images can be drawn consistent with earlier
ones:

| Phase | Image | Blueprint input | References | Patched into |
|---|---|---|---|---|
| 1 | Character portrait | `visual_direction` (or legacy `art_style`), the character's `first_name`, `appearance`, `personality` | none | `portrait_image_id` |
| 2 | Location scene | `visual_direction`, the location's `name` and `description` | portraits of characters there | `location_image_id` |
| 3 | Cover | `cover_image.description`, `visual_direction`, `metadata.title` | portraits and scenes for `cover_image.character_ids` and `location_ids` | `metadata.image_id` |

- A portrait's backdrop is `visual_direction.portrait_background` when set,
  otherwise a built-in bokeh wash, and never depicts a mystery location.
- References are sent as `input_references[]` in the order the prompt's legend
  numbers them ("Image 1: Portrait of …"), because the model identifies them by
  position. At most 16 are sent; beyond that the first 16, with a warning.
- `--chat-packets` writes the same prompts, with the references to upload in
  the same order, for pasting into a chat.
<!-- /extract:image-generation -->

The CLI checks a ratio only against OpenRouter's full list; `openai/gpt-image-1`
accepts only `1:1`, `3:2`, `2:3` and `auto`. A failed generation is a 502, not
billed; re-run just the failed targets.

## Generating 3D scenes

`./dev eval scenes <blueprint.json> --install` generates missing location
recipes through the `scene-generator` binding, keeping existing ones. Prompts get
only visual direction, location names, descriptions and searchable-area names,
never clues, hints or solutions. The run keeps prompts, attempts, `scenes.json`
and `result.json`; a failure never replaces installed art.

`packages/shared/src/scene-schema.ts` bounds shapes, transforms and animations,
rejecting executable fields and unknown references. Manifests live in
`blueprint-scenes/<blueprint-id>.json`, the config root's winning over committed
examples; the `blueprint-scenes` endpoint serves only these.

## Narration at play
<!-- extract:gameplay-narration -->

Every row also receives `metadata.target_age` and `metadata.narration_style`.

| Output | Source (role) | Blueprint input | Other input | Attached |
|---|---|---|---|---|
| Opening | `game-start` | `narrative.premise` | — | `metadata.image_id` |
| Arrival | the move action, `game-enter` (`ambience`) | The destination's `name`, `description`, unhidden sub-location names; for each character there, their looks, `personality`, attitude, `always` tells, and a manner per live agenda | The last arrival's narration there, whether it was visited before | `location_image_id` |
| Search | the search action (`search_bare`, `search_targeted`) | The location's `description` and unlocked `clues`; each unhidden sub-location's `name`, `hint` and unlocked clues | History at that location; the player's `search_query` | — |
| Conversation | the talk, ask and end-talk actions (`talk_*`) | Location summaries; every character's public face; the active character's private fields — `background`, `clues`, `flavor_knowledge`, `actual_actions` (only steps safe to say), `agendas` (reactions and confession once earned), `tells`, alibi, motive, personality, attitude | History with that character, and their state; `player_known_clues` | `portrait_image_id` (start, ask) |
| Accusation start | the accuse action (`accusation_start`), or a forced endgame | Location and timing; the public roster | All history, or none | — |
| Accusation judge | the accuse action (`accusation_judge`) | The **full** blueprint, including `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths` | All history, or none; the reasoning; the round; `player_known_clues`, `path_coverage` | — |

A character's **public face** is `first_name`, `last_name`, `sex`,
`appearance`, and their `starting_knowledge` summary. Private
fields reach only that character's own conversation.

`narrative.starting_knowledge` is never narrated: `game-start` and `game-get`
return it as the notebook's case facts (`mystery_summary`, and a `summary` per
location and character).
<!-- /extract:gameplay-narration -->

## Evaluation

Judging: `docs/evaluation-pipeline.md`.
