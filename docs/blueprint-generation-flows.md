# Blueprint Generation Flows

This document maps which blueprint data currently flows into each generated
output.

Use it as the implementation-level companion to:

- `docs/ai-runtime.md` for gameplay narration runtime mechanics
- `docs/ai-configuration.md` for AI provider and image-generation config
- `docs/evaluation-pipeline.md` for how generated blueprints are evaluated
- `docs/game.md` for player-facing game rules and flow

The goal here is narrow: show which blueprint fields actually reach each
generation path today, and distinguish those inputs from static image IDs that
are only attached after generation.

## Schema Version

All runtime endpoints, the blueprint generator, evaluator, and image pipeline
use **Blueprint V2** (`packages/shared/src/blueprint-schema-v2.ts`).

All entity lookups are ID-based. The session DB stores V2 location and character
IDs (`current_location_id`, `current_talk_character_id`). Client API requests
use IDs (`character_id`, `destination` as location ID).

## Reading the Matrix

- "Generation input" means blueprint data sent into the AI prompt or context.
- "Attached after generation" means the generated text is paired with an
  existing `image_id` that did not shape it.
- Every runtime prompt is assembled in `role-request.ts` (`docs/ai-runtime.md`);
  the only context shared by all roles is `target_age`.

## Blueprint Generation Prompt Structure

Blueprint generation is handled by
`packages/blueprint-generator/src/index.ts`, not by a gameplay runtime
endpoint.

The OpenRouter request has three important parts:

1. `system` message:
   the full contents of
   `packages/blueprint-generator/src/generator-prompt.md`, followed by
   `renderGenerationGuidance(targetAge)` from
   `packages/shared/src/age-profile.ts` — the same single source of truth the
   runtime narrator's `{{age_guidance}}` comes from
2. `user` message:
   a JSON object containing the validated `story_brief` plus a fixed
   instruction string
3. `response_format`:
   a strict JSON Schema derived from `BlueprintV2Schema`, with generated image
   ID fields removed before submission

When the local operator CLI `scripts/generate-blueprint.mjs` writes blueprint
files, it runs the evaluation pipeline's mechanical checks
(`evaluation/checks/mechanical.mjs`) in-process — no model call — and writes the
result to a sibling `*.verification.json`. A failing check does not stop the
blueprint file being written.

The same CLI also supports `--chat-packet` export mode. In that branch it does
not call OpenRouter; instead it renders a markdown packet from the same
generator system prompt, user-message JSON, and response-schema builder used by
the live request path. That packet is intentionally one-way: the operator pastes
it into chat, saves the returned JSON manually, and then validates it
afterward.

### `story_brief` Shape
<!-- extract:story-brief -->

The generator validates the incoming brief against
`packages/blueprint-generator/src/story-brief.ts` before sending anything to
the model.

| Field          | Type       | Required | Purpose                                                       |
| -------------- | ---------- | -------- | ------------------------------------------------------------- |
| `brief`        | `string`   | Yes      | Free-form high-level mystery brief.                           |
| `targetAge`    | `number`   | Yes      | Reading level / tone target for generated content.            |
| `timeBudget`   | `number`   | No       | Hint for the blueprint's turn budget.                         |
| `titleHint`    | `string`   | No       | Suggested mystery title.                                      |
| `artStyle`     | `string`   | No       | Suggested visual direction for later static image generation. |
| `mustInclude`  | `string[]` | No       | Required story ingredients or constraints.                    |
| `culprits`     | `number`   | No       | Number of culprits (default: 1).                              |
| `suspects`     | `number`   | No       | Number of red-herring suspects.                               |
| `witnesses`    | `number`   | No       | Number of witness characters.                                 |
| `locations`    | `number`   | No       | Number of locations.                                          |
| `redHerringTrails` | `number` | No    | Number of red herring plot threads.                           |
| `coverUps`     | `boolean`  | No       | Whether suspects should have cover stories or false alibis.   |
| `eliminationComplexity` | `string` | No | `"simple"`, `"moderate"`, or `"complex"`.                   |
| `minPathLength` | `number`  | No       | Hard floor on solution-path length: the shortest route to the culprit must need at least this many distinct, necessary clues. Enforced by the `solve_depth` evaluation. |
| `targetPathLength` | `number` | No    | Desired solution-path length the generator aims for (hint only; not judged). Treat as `>= minPathLength`. |
<!-- /extract:story-brief -->

### `user` Message Shape

The generator sends the validated brief to the model as JSON in the `user`
message with this structure:

```json
{
  "story_brief": {
    "brief": "string",
    "targetAge": 8,
    "timeBudget": 10,
    "titleHint": "optional string",
    "artStyle": "optional string",
    "mustInclude": ["optional", "string", "array"]
  },
  "instructions": "Return only a JSON object that satisfies the provided response schema."
}
```

### System Prompt Summary
<!-- extract:generator-prompt -->

The system prompt in `generator-prompt.md` tells the model to:

- write a complete, logically sound children's mystery blueprint in V2 shape
- follow an explicit workflow that locks:
  - hidden truth
  - actual character actions
  - solution paths
  - red herrings
  - suspect-elimination paths
  - structured clue distribution
  - flavor pass
- keep all text age-appropriate for the requested target age, on two dials that
  mirror the runtime narrator's: **complexity** (age only — sentence length,
  vocabulary, new-word allowance) and **length** (an explicit per-age word
  budget for each authored player-facing prose field: `metadata.one_liner`,
  `narrative.premise`, every `starting_knowledge` summary, every location
  `description`, and every clue `text`). Names — `metadata.title`, location and
  sub-location names — carry no word budget because a name is a label rather
  than prose and does not scale with reading age; `generator-prompt.md` sizes
  those directly. Where a budget applies, `generator-prompt.md` defers to it
  rather than stating its own sentence count.
- calibrate challenge around `story_brief.timeBudget` when present, or infer a
  moderate `metadata.time_budget` when absent
- keep clue count, suspect count, red herrings, and timeline complexity within
  explicit sizing bands
- make the mystery fair and solvable through clues and reasoning
- before output, verify that the *shortest* solution path needs at least
  `minPathLength` distinct, necessary clues — tracing the minimal clue subset the
  way the `solve_depth` judge measures it (every solution path counts; the
  shortest sets the score) — and deepen the chain if it falls short
- enforce coherence between premise, clue placement, character facts, authored
  reasoning paths, and ground truth
- emit structured location clues and character clues with stable ids and roles
- emit separate `flavor_knowledge` instead of generic mystery `knowledge`
- emit ordered per-character `actual_actions`
- author character agendas that create conversational friction (self-protection,
  protect-other, implicate-other, conditional-reveal) and scale them based on
  story brief complexity knobs
- author cross-character knowledge clues (`alibi_knowledge`,
  `witness_testimony`, `motive_knowledge`, `location_hint`) that create
  character interdependence
- enforce agenda solvability: at least one solution path must be completable
  without narrative-condition gated clues, and no circular dependencies
- design the clue discovery graph: clues may carry an optional `requires`
  (`{ clue_ids, rationale }`) gating them behind other discovered clues. The
  generator authors mostly-ungated, branchy, acyclic graphs (each reasoning path a
  small mini-mystery with ≥1 ungated entry clue) and keeps every solution clue
  reachable from ungated roots. The schema `superRefine` and the `clue_graph`
  evaluation dimension enforce this; the runtime consumes `requires` for clue
  gating (see `docs/ai-runtime.md`).
- ensure exactly one culprit and a logically consistent timeline
- use the shared `BlueprintV2Schema`
- emit `cover_image` with creative visual direction for the cover illustration,
  plus optional location and character references for visual consistency
- omit `image_id`, `location_image_id`, and `portrait_image_id` from generated
  output because those are assigned later by image tooling
<!-- /extract:generator-prompt -->

## Static Image Generation
<!-- extract:image-generation -->

These images are generated by the operator CLI, not during gameplay runtime.

The CLI calls OpenRouter's dedicated Images API
(`POST https://openrouter.ai/api/v1/images`) and writes the returned
`data[0].b64_json` bytes straight to `<image_id>.png` (`output_format: "png"`).
The aspect ratio comes from `--aspect-ratio` / `OPENROUTER_IMAGE_ASPECT_RATIO`
(default `4:3`) and is sent as the `aspect_ratio` request param *and*
interpolated into the prompt's `Output:` line, so the two cannot disagree.

Image generation runs in three phases to enable reference-image consistency:

1. **Phase 1 — Character portraits**: No references needed. Produces
   standalone portraits with an abstract, location-agnostic backdrop —
   `metadata.visual_direction.portrait_background` when the blueprint supplies
   one, otherwise the built-in bokeh wash. Portrait backdrops never depict a
   mystery location.
2. **Phase 2 — Location scenes**: Receives generated portrait images as
   labeled references for characters present at each location.
3. **Phase 3 — Blueprint cover**: Receives both portrait and location scene
   references based on `cover_image.character_ids` and
   `cover_image.location_ids`.

The image CLI also supports `--chat-packets` export mode. That branch still uses
`buildImagePrompt(...)` for the prompt text, but replaces automatic API calls
with one markdown packet per selected target. Each packet lists the required
reference images in the same order that the API path would attach them, so the
operator can upload them manually in chat.

Reference images are passed as labeled `{ label, buffer }` objects. The prompt
builder generates an indexed legend ("Image 1: Portrait of Alice Smith…") and
the request sends them as `input_references[]` base64 PNG data URLs in matching
order — the model uses ordinal position to identify each reference. References
are capped at 16 (the `input_references` limit the gpt-image family
advertises); a target that exceeds the cap logs a warning and sends the first
16.

| Generated output     | Entry point                                                                                     | Blueprint fields used as generation input                                                                                                                                                                                                                 | Attached or patched after generation                                           | Notes                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Mystery cover image  | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "blueprint" })` | `cover_image.description`, `cover_image.location_ids`, `cover_image.character_ids`, `metadata.visual_direction` (falls back to `metadata.art_style`), `metadata.title`. Portrait and location scene reference images attached for `cover_image` character/location ids. | Resulting `image_id` is patched back to `metadata.image_id`                    | Generated in phase 3 after portraits and location scenes. The 16-reference cap applies to `cover_image.character_ids` and `cover_image.location_ids` combined. |
| Character portrait   | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "character" })` | `metadata.visual_direction` incl. optional `portrait_background` (falls back to `metadata.art_style`), `world.characters[].first_name`, `world.characters[].appearance`, `world.characters[].personality`                                                            | Resulting `image_id` is patched back to `world.characters[].portrait_image_id` | Generated in phase 1 (no references). Backdrop comes from `metadata.visual_direction.portrait_background` when set, otherwise the built-in bokeh wash; either way it stays abstract and must not depict a story location.        |
| Location scene image | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "location" })`  | `metadata.visual_direction` (falls back to `metadata.art_style`), `world.locations[].name`, `world.locations[].description`. Portrait reference images attached for characters present at the location.                          | Resulting `image_id` is patched back to `world.locations[].location_image_id`  | Generated in phase 2 with portrait references for character consistency. |
<!-- /extract:image-generation -->

## Gameplay Narration
<!-- extract:gameplay-narration -->

These outputs are generated at runtime in the game server using
Blueprint V2.

| Generated output                  | Entry point                                                                                                             | Blueprint fields used as generation input                                                                                                                                                                                                                                                                                                                         | Non-blueprint context also used                                                                        | Attached after generation                                                                    | Notes                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opening narration                 | `game-start`                                                                                                            | `metadata.target_age`, `narrative.premise`                                                                                                                                                                                                                                                                                                                        | Session AI profile selection only                                                                      | `metadata.image_id` attached as the first narration part image                               | A short static notebook-guidance narrator part is appended as the second part of the `start` event. `narrative.starting_knowledge` is no longer dumped into narration — it is surfaced as structured `state` fields (`mystery_summary`, `premise`, per-location/character `summary`) that feed the in-game notebook. See [ai-runtime.md](ai-runtime.md) (Notebook data on the session boundary). |
| Move narration                    | `game-move`                                                                                                             | `metadata.target_age`, `metadata.narration_style`, destination `world.locations[].name`, destination `world.locations[].description`, destination `world.locations[].sub_locations[].name` (as searchable area list), destination `world.characters[]` filtered by `location_id` with public summaries (`id`, `first_name`, `last_name`, `sex`, `appearance`, plus `public_summary` from `narrative.starting_knowledge.characters[]`)                     | Prior event history filtered to the destination location, plus a computed `has_visited_before` flag    | Destination `world.locations[].location_image_id` attached as the narration part image       | Move prompting explicitly tells the model to acknowledge return visits, stay consistent with prior descriptions, prominently mention searchable sub-locations so the player knows what to investigate, use only the provided destination character summaries when mentioning who is present, and use `sex` for pronoun choice instead of guessing. Character `background` is private and no longer reaches move narration. |
| Search narration                  | `game-search` with role `search` (prompt variants `search_bare` / `search_targeted`)                                    | Shared context: `metadata.target_age` only. Role-specific `search_context`: current location `id`, `name`, `description`, location-level `clues`, sub-location context (each with `id`, `name`, `hint`, `clues`, `unrevealed_clues`, `has_unrevealed_clues`), already-revealed clue IDs, next unrevealed location-level clue, `search_query` (null for bare search) | Prior event history filtered to the current location                                                   | Nothing                                                                                      | Bare search reveals the first unrevealed AND unlocked location-level clue (clues gated by unmet `requires` are skipped). Targeted search passes player's freeform text to AI which judges match against sub-locations with GM leeway; locked clues are filtered out of context and a backend backstop rejects a locked reveal. AI returns `revealed_clue_id` and `costs_turn`; backend validates before persisting and materializes `game_sessions.discovered_clues`. |
| Talk-start narration              | `game-talk` with role `talk_start`                                                                                      | Shared context: `metadata.target_age` only. Role-specific `talk_context`: active location description, grounded location list, grounded public character list (with `id`, `location_id`), and the active character's private roleplay data including `clues`, `flavor_knowledge`, `actual_actions`, all including character `sex`                                  | Prior `talk`/`ask`/`end_talk` history for the active character                                         | Active character `world.characters[].portrait_image_id` attached as the narration part image | Prompt explicitly forbids inventing new characters or locations and instructs the model to use provided `sex` for pronouns.                                                                                                                                  |
| Ask response narration            | `game-ask` with role `talk_conversation`                                                                                | Same talk context as talk-start. Character knowledge is split into mystery `clues` (with roles) and `flavor_knowledge`. `actual_actions` provides an ordered timeline of what the character really did                                                                                                                                                             | Same-character conversation history, including prior `player_input` payloads and latest `player_input` | Active character `world.characters[].portrait_image_id` attached as the narration part image | Speaker is the in-world character, not the narrator. Flavor knowledge is shared freely; mystery clues only on relevant questions.                                                                                                                            |
| Talk-end narration                | `game-end-talk` with role `talk_end`                                                                                    | Same talk context as talk-start                                                                                                                                                                                                                                                                                                                                   | Same-character conversation history, including prior `player_input` payloads                           | Nothing                                                                                      | Closes conversation and returns the session to explore mode. Prompt also instructs the model to use provided `sex` for pronouns.                                                                                                                             |
| Accusation-start narration        | `game-accuse` with role `accusation_start`                                                                              | Shared context: `metadata.target_age` only. Role-specific accusation-start location/timing context plus the spoiler-safe public character roster (`id`, names, `sex`, `appearance`, `public_summary`) so the narrator can name suspects with grounded pronouns                                                                                                    | Full prior event history by default, unless `accusation_history_mode` is set to `none`                 | Nothing                                                                                      | This path stays spoiler-safe and does not receive the full blueprint.                                                                                                                                                                                        |
| Forced accusation-start narration | `generateForcedAccusationStartNarration(...)` used by `game-move`, `game-search`, and `game-talk` when time reaches zero | Same blueprint-driven context as accusation-start                                                                                                                                                                                                                                                                                                                 | Full prior event history plus a function-supplied `scene_summary`, with `forced_by_timeout=true`       | Nothing                                                                                      | This is appended after the action narration that consumed the last turn. Prompt guidance also forbids guessing pronouns and expects use of provided character `sex` from history/full context when relevant.                                                 |
| Accusation judge narration        | `game-accuse` with role `accusation_judge`                                                                              | Shared context: `metadata.target_age` only. Role-specific `accusation_judge_context` contains the full blueprint: `metadata`, `narrative`, `world`, `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths`                                                                                                                                  | Full prior event history by default, current `player_reasoning`, accusation round count                | Nothing                                                                                      | The judge accepts (`win`) only when the player names the true culprit AND either follows a `solution_paths` evidence chain or correctly tells the story of what happened (culprit + sequence of events + motive vs `ground_truth`); a confrontation can earn a confession only when most facts are already right. Wrong or under-supported accusations are rejected with encouragement (`continue`); from round 3 a still-failing accusation resolves `lose`.                                                                        |
<!-- /extract:gameplay-narration -->

## Where each field is used

Not mapped here: search the code for the field name. The tables above are the
view that code cannot give you — which fields shape each generated output. Two
rules the tables imply:

- Only `accusation_judge` receives the full blueprint; every other narrator role
  gets a slice, and `assertRoleContextSafety` enforces it.
- Image ids (`metadata.image_id`, `location_image_id`, `portrait_image_id`) are
  stripped from generator output and patched in later by the image CLI; they
  never shape generated text.

## Evaluation

Generated blueprints are judged by the pipeline in `evaluation/`
(`docs/evaluation-pipeline.md`).
