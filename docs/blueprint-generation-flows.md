# Blueprint Generation Flows

Which blueprint data reaches each generated output: the blueprint itself, its
images, and the narration at play. The schema, and the intent behind every
field, is `packages/shared/src/blueprint-schema-v2.ts`; what each narrator role
may see, and why, is `docs/ai-runtime.md`.

"Input" below means data sent to the model. "Attached" means an image id paired
with the output afterwards, which never shaped it. Everything is looked up by
id, and sessions store ids, never names.

## Generating a blueprint

`packages/blueprint-generator/src/index.ts`, driven by
`scripts/generate-blueprint.mjs`, sends OpenRouter three things:

1. **System:** `packages/blueprint-generator/src/generator-prompt.md`, followed
   by the age guidance for the brief's `targetAge`
   (`renderGenerationGuidance` in `packages/shared/src/age-profile.ts`, the
   same source as the narrator's).
2. **User:** the brief, validated against
   `packages/blueprint-generator/src/story-brief.ts`, and an instruction to
   answer in the schema.
3. **Response format:** a strict JSON Schema from `BlueprintV2Schema`, with the
   image-id fields removed — image tooling fills those in later.

Every written blueprint gets the evaluation pipeline's mechanical checks, run
in-process, in a sibling `*.verification.json`; a failing check does not stop
the file being written. `--chat-packet` renders the same three parts as a
Markdown packet to paste into a chat instead.

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
- Agendas (self-protection, protect-other, implicate-other, conditional
  reveal) and cross-character clues (`alibi_knowledge`, `witness_testimony`,
  `motive_knowledge`, `location_hint`), with at least one solution path
  completable without condition-gated clues.
- A clue discovery graph through `requires`: mostly ungated, acyclic, every
  solution clue reachable from an ungated root. The schema's `superRefine` and
  the `clue_graph` dimension enforce it.
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

Aspect-ratio support varies by model, and the CLI checks a ratio only against
the full list OpenRouter documents; `openai/gpt-image-1`, for one, accepts only
`1:1`, `3:2`, `2:3` and `auto`. A failed or cancelled generation comes back as
a 502 and is not billed. The run continues past a failed target, so re-run just
those targets.

## Narration at play
<!-- extract:gameplay-narration -->

Every row also receives `metadata.target_age` and `metadata.narration_style`.

| Output | Endpoint (role) | Blueprint input | Other input | Attached |
|---|---|---|---|---|
| Opening | `game-start` | `narrative.premise` | — | `metadata.image_id` |
| Arrival | `game-move`, `game-enter` (`ambience`) | The destination's `name`, `description`, sub-location names; for each character there, the same private fields a conversation gets | History at that location, whether it was visited before; `player_known_clues` | `location_image_id` |
| Search | `game-search` (`search_bare`, `search_targeted`) | The location's `description` and `clues`; each sub-location's `name`, `hint` and unlocked clues | History at that location; the player's `search_query` | — |
| Conversation | `game-talk`, `game-ask`, `game-end-talk` (`talk_*`) | Location summaries; every character's public face; the active character's private fields — `clues`, `flavor_knowledge`, `actual_actions`, `agendas`, `tells`, alibi, motive, personality, attitude | History with that character; `player_known_clues` | `portrait_image_id` (start, ask) |
| Accusation start | `game-accuse` (`accusation_start`), or a forced endgame | Location and timing; the public roster | All history, or none | — |
| Accusation judge | `game-accuse` (`accusation_judge`) | The **full** blueprint, including `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths` | All history, or none; the reasoning; the round; `player_known_clues`, `path_coverage` | — |

A character's **public face** is `first_name`, `last_name`, `sex`,
`appearance`, and the `starting_knowledge` summary for that character. Private
fields reach only that character's own conversation and arrivals where they are
present, never another character's scene; knowledge about other characters
travels only through clues with `about_character_id`.

`narrative.starting_knowledge` is never narrated: `game-start` and `game-get`
return it as the notebook's case facts (`mystery_summary`, and a `summary` per
location and character).
<!-- /extract:gameplay-narration -->

## Evaluation

Generated blueprints are judged by the pipeline in `evaluation/`
(`docs/evaluation-pipeline.md`).
