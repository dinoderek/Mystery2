# Blueprint Generation Flows

Blueprint, artwork and narration inputs. Field intent:
`packages/shared/src/blueprint-schema-v2.ts`; narrator context:
`docs/ai-runtime.md`. “Input” means sent to the model; “attached” means paired
with its output. Sessions store ids.

## Generating a blueprint

`./dev eval generate` uses `buildBlueprintGenerationChatInput` in
`packages/blueprint-generator` for both backends:

- **System:** `packages/blueprint-generator/src/generator-prompt.md` plus age
  guidance from `renderGenerationGuidance` in `packages/shared/src/age-profile.ts`.
- **User:** the brief, validated against
  `packages/blueprint-generator/src/story-brief.ts`, with schema instructions.
- **API response format:** strict JSON Schema from `BlueprintV2Schema`, excluding
  image ids. Strict-mode nulls for absent optional fields are removed.

The agent backend gets the same prompt and brief in its workspace. Both
validate the schema and mechanical checks and save `result.json`.
Rejected blueprints are kept for inspection and never installed
(`evaluation/README.md`).

### Repair rounds

`./dev eval generate <brief> --judge --repair <n>` (default 0: none) adds up to
`n` repair rounds after round 0, the generation as above
(`evaluation/generate/repair.ts`):

- A round runs only while a check or judge **failed** (an `error` is not the
  blueprint's fault). The generator agent gets a fresh workspace seeded with the
  last round's blueprint and `repair.json`, and follows the repair protocol in
  `evaluation/generator-harness/template/CLAUDE.md`: fix those faults only, in
  place, and pass the validator.
- `repair.json` quotes each failing verdict: a check's or analyzer's
  `details`, or a judge's answer with its reasoning, less the items it found
  sound. They travel inside the user message under a notice that they are data,
  not instructions.
- Every mechanical check and every judge then runs again, through the binding and
  battery `--judge` uses, so they are the judges the truth set measures. Judges
  are sent the brief and the blueprint only, never the generator's work or an
  earlier round. `--model-override blueprint-judge=…` leaves the measured
  judges.
- Each round's cost (generator and judge calls) is printed, with the run's
  total.

The api backend is one call that writes a blueprint from a brief and cannot edit
one, so `--repair` refuses it. Round 0 is always kept: its first-pass status is
the signal for improving the generator prompt, and the round cap and the stored
round 0 guard against teaching to the test (a fix that satisfies a judge's
wording, or makes the blueprint blander). The output is in
`evaluation/README.md`.

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

The CLI checks a ratio only against OpenRouter's full list, and models vary:
`openai/gpt-image-1` accepts only `1:1`, `3:2`, `2:3` and `auto`. A failed or
cancelled generation is a 502, not billed. The run continues past a failed
target, so re-run just those.

## Generating 3D scenes

`./dev eval scenes <blueprint.json> --install` generates missing location recipes
through the `scene-generator` CLI binding and the shared model runner. Existing
recipes are preserved. Prompts receive only
visual direction, location names and descriptions, and searchable-area names;
clues, hints and solutions are excluded. The run keeps prompts, attempts,
`scenes.json` and `result.json`; failed generation never replaces installed art.

`packages/shared/src/scene-schema.ts` bounds shapes, transforms and animations
and rejects executable fields and unknown references. Manifests live in
`blueprint-scenes/<blueprint-id>.json`, with config-root precedence over committed
examples. The catalog's `blueprint-scenes` endpoint serves only these validated
public recipes. New settings use the same renderer.

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

Generated blueprints are judged by the pipeline in `evaluation/`
(`docs/evaluation-pipeline.md`).
