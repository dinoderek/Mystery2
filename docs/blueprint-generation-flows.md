# Blueprint Generation Flows

This document maps which blueprint data currently flows into each generated
output.

Use it as the implementation-level companion to:

- `docs/ai-runtime.md` for gameplay narration runtime mechanics
- `docs/ai-configuration.md` for AI provider and image-generation config
- `docs/blueprint-evaluation.md` for the evaluator prompt, output schema, and
  blueprint-evaluation follow-up notes
- `docs/game.md` for player-facing game rules and flow

The goal here is narrow: show which blueprint fields actually reach each
generation path today, and distinguish those inputs from static image IDs that
are only attached after generation.

## Schema Version

All runtime endpoints, the blueprint generator, evaluator, and image pipeline
use **Blueprint V2** (`supabase/functions/_shared/blueprints/blueprint-schema-v2.ts`).

All entity lookups are ID-based. The session DB stores V2 location and character
IDs (`current_location_id`, `current_talk_character_id`). Client API requests
use IDs (`character_id`, `destination` as location ID).

## Reading the Matrix

- "Generation input" means blueprint data sent into the AI prompt or context.
- "Attached after generation" means the generated text is paired with an
  existing `image_id`, but that image ID did not shape the text output.
- Shared runtime context is intentionally narrow and now contains only
  `target_age`.
- Runtime narration uses two different patterns today:
  - `game-start` and `game-move` build ad hoc prompts directly in the function.
  - `game-search`, `game-talk`, `game-ask`, `game-end-talk`, and
    `game-accuse` use prompt templates plus `ai-context.ts`.
- When narrator behavior or blueprint-fed AI inputs change, update this file and
  `docs/ai-runtime.md` together so the field map and runtime behavior stay in
  sync.
- When evaluator assumptions or blueprint-quality contracts change, also update
  `docs/blueprint-evaluation.md`.

## Blueprint Generation Prompt Structure

Blueprint generation is handled by
`packages/blueprint-generator/src/index.ts`, not by a gameplay runtime
endpoint.

The OpenRouter request has three important parts:

1. `system` message:
   the full contents of
   `supabase/functions/_shared/blueprints/generator-prompt.md`
2. `user` message:
   a JSON object containing the validated `story_brief` plus a fixed
   instruction string
3. `response_format`:
   a strict JSON Schema derived from `BlueprintV2Schema`, with generated image
   ID fields removed before submission

When the local operator CLI `scripts/generate-blueprint.mjs` writes blueprint
files, it immediately performs a second OpenRouter verification pass against the
generated Blueprint V2 and writes a sibling verification artifact next to each
blueprint JSON file. Verification uses the shared evaluator prompt/schema and
does not block the blueprint file from being written first.

The same CLI also supports `--chat-packet` export mode. In that branch it does
not call OpenRouter; instead it renders a markdown packet from the same
generator system prompt, user-message JSON, and response-schema builder used by
the live request path. That packet is intentionally one-way: the operator pastes
it into chat, saves the returned JSON manually, and then validates it
afterward.

### `story_brief` Shape

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
- keep all text age-appropriate for the requested target age
- calibrate challenge around `story_brief.timeBudget` when present, or infer a
  moderate `metadata.time_budget` when absent
- keep clue count, suspect count, red herrings, and timeline complexity within
  explicit sizing bands
- make the mystery fair and solvable through clues and reasoning
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
- ensure exactly one culprit and a logically consistent timeline
- use the shared `BlueprintV2Schema`
- emit `cover_image` with creative visual direction for the cover illustration,
  plus optional location and character references for visual consistency
- omit `image_id`, `location_image_id`, and `portrait_image_id` from generated
  output because those are assigned later by image tooling

## Static Image Generation

These images are generated by the operator CLI, not during gameplay runtime.

Image generation runs in three phases to enable reference-image consistency:

1. **Phase 1 — Character portraits**: No references needed. Produces
   standalone portraits with abstract bokeh backgrounds.
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
the request places images after the text in matching order — the model uses
ordinal position to identify each reference.

| Generated output     | Entry point                                                                                     | Blueprint fields used as generation input                                                                                                                                                                                                                 | Attached or patched after generation                                           | Notes                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Mystery cover image  | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "blueprint" })` | `cover_image.description`, `cover_image.location_ids`, `cover_image.character_ids`, `metadata.visual_direction` (falls back to `metadata.art_style`), `metadata.title`, `id` (stable seed phrase). Portrait and location scene reference images attached for `cover_image` character/location ids. | Resulting `image_id` is patched back to `metadata.image_id`                    | Generated in phase 3 after portraits and location scenes.            |
| Character portrait   | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "character" })` | `metadata.visual_direction` (falls back to `metadata.art_style`), `world.characters[].first_name`, `world.characters[].appearance`, `world.characters[].personality`, `id` (stable seed phrase)                                                            | Resulting `image_id` is patched back to `world.characters[].portrait_image_id` | Generated in phase 1 (no references). Uses bokeh background.        |
| Location scene image | `scripts/generate-blueprint-images.mjs` -> `buildImagePrompt(..., { targetType: "location" })`  | `metadata.visual_direction` (falls back to `metadata.art_style`), `world.locations[].name`, `world.locations[].description`, `id` (stable seed phrase). Portrait reference images attached for characters present at the location.                          | Resulting `image_id` is patched back to `world.locations[].location_image_id`  | Generated in phase 2 with portrait references for character consistency. |

## Gameplay Narration

These outputs are generated at runtime in Supabase Edge Functions using
Blueprint V2.

| Generated output                  | Entry point                                                                                                             | Blueprint fields used as generation input                                                                                                                                                                                                                                                                                                                         | Non-blueprint context also used                                                                        | Attached after generation                                                                    | Notes                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opening narration                 | `game-start`                                                                                                            | `metadata.target_age`, `narrative.premise`                                                                                                                                                                                                                                                                                                                        | Session AI profile selection only                                                                      | `metadata.image_id` attached as the first narration part image                               | `narrative.starting_knowledge` (a structured object with mystery summary, location summaries, and character summaries) is formatted and appended after generation as a second narrator block in the same `start` event.                                                                                                                                            |
| Move narration                    | `game-move`                                                                                                             | `metadata.target_age`, destination `world.locations[].name`, destination `world.locations[].description`, destination `world.locations[].sub_locations[].name` (as searchable area list), destination `world.characters[]` filtered by `location_id` with public summaries (`id`, `first_name`, `last_name`, `sex`, `appearance`, `background`)                     | Prior event history filtered to the destination location, plus a computed `has_visited_before` flag    | Destination `world.locations[].location_image_id` attached as the narration part image       | Move prompting explicitly tells the model to acknowledge return visits, stay consistent with prior descriptions, prominently mention searchable sub-locations so the player knows what to investigate, use only the provided destination character summaries when mentioning who is present, and use `sex` for pronoun choice instead of guessing. |
| Search narration                  | `game-search` with role `search` (prompt variants `search_bare` / `search_targeted`)                                    | Shared context: `metadata.target_age` only. Role-specific `search_context`: current location `id`, `name`, `description`, location-level `clues`, sub-location context (each with `id`, `name`, `hint`, `clues`, `unrevealed_clues`, `has_unrevealed_clues`), already-revealed clue IDs, next unrevealed location-level clue, `search_query` (null for bare search) | Prior event history filtered to the current location                                                   | Nothing                                                                                      | Bare search reveals location-level clues sequentially. Targeted search passes player's freeform text to AI which judges match against sub-locations with GM leeway. AI returns `revealed_clue_id` and `costs_turn`; backend validates before persisting. |
| Talk-start narration              | `game-talk` with role `talk_start`                                                                                      | Shared context: `metadata.target_age` only. Role-specific `talk_context`: active location description, grounded location list, grounded public character list (with `id`, `location_id`), and the active character's private roleplay data including `clues`, `flavor_knowledge`, `actual_actions`, all including character `sex`                                  | Prior `talk`/`ask`/`end_talk` history for the active character                                         | Active character `world.characters[].portrait_image_id` attached as the narration part image | Prompt explicitly forbids inventing new characters or locations and instructs the model to use provided `sex` for pronouns.                                                                                                                                  |
| Ask response narration            | `game-ask` with role `talk_conversation`                                                                                | Same talk context as talk-start. Character knowledge is split into mystery `clues` (with roles) and `flavor_knowledge`. `actual_actions` provides an ordered timeline of what the character really did                                                                                                                                                             | Same-character conversation history, including prior `player_input` payloads and latest `player_input` | Active character `world.characters[].portrait_image_id` attached as the narration part image | Speaker is the in-world character, not the narrator. Flavor knowledge is shared freely; mystery clues only on relevant questions.                                                                                                                            |
| Talk-end narration                | `game-end-talk` with role `talk_end`                                                                                    | Same talk context as talk-start                                                                                                                                                                                                                                                                                                                                   | Same-character conversation history, including prior `player_input` payloads                           | Nothing                                                                                      | Closes conversation and returns the session to explore mode. Prompt also instructs the model to use provided `sex` for pronouns.                                                                                                                             |
| Accusation-start narration        | `game-accuse` with role `accusation_start`                                                                              | Shared context: `metadata.target_age` only. Role-specific accusation-start location/timing context                                                                                                                                                                                                                                                                | Full prior event history by default, unless `accusation_history_mode` is set to `none`                 | Nothing                                                                                      | This path stays spoiler-safe and does not receive the full blueprint.                                                                                                                                                                                        |
| Forced accusation-start narration | `generateForcedAccusationStartNarration(...)` used by `game-move`, `game-search`, and `game-ask` when time reaches zero | Same blueprint-driven context as accusation-start                                                                                                                                                                                                                                                                                                                 | Full prior event history plus a function-supplied `scene_summary`, with `forced_by_timeout=true`       | Nothing                                                                                      | This is appended after the action narration that consumed the last turn. Prompt guidance also forbids guessing pronouns and expects use of provided character `sex` from history/full context when relevant.                                                 |
| Accusation judge narration        | `game-accuse` with role `accusation_judge`                                                                              | Shared context: `metadata.target_age` only. Role-specific `accusation_judge_context` contains the full blueprint: `metadata`, `narrative`, `world`, `ground_truth`, `solution_paths`, `red_herrings`, `suspect_elimination_paths`                                                                                                                                  | Full prior event history by default, current `player_reasoning`, accusation round count                | Nothing                                                                                      | The judge uses `solution_paths` to check valid reasoning chains, `suspect_elimination_paths` to verify correct suspect ruling, and `red_herrings` to assess if the player was misled.                                                                        |

## Blueprint Field Usage Map

This section flips the view: instead of starting from each generated output, it
starts from each **Blueprint V2** schema field and lists where that field is
consumed today.

Scope notes:

- "Used" includes prompt/context input, player-facing API shaping, image-link
  validation, operator tooling, and storage seeding.
- `game-accuse` judge mode receives the full blueprint in
  `accusation_judge_context`, so all leaf fields are available there even when a
  row below calls out narrower consumers separately.
- All runtime lookups are ID-based (location by `id`, character by `id`,
  clue by `id`).

### Root

| Field            | Where used now                                                                                                                                                                                                                                                                                                                              | Notes                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `schema_version` | `BlueprintV2Schema.parse()` validates this is `"v2"` on every endpoint                                                                                                                                                                                                                                                                     | Required discriminator for V2 parsing.                                           |
| `id`             | `game-start` persists `game_sessions.blueprint_id`; `blueprints-list` returns it to the UI; `game-sessions-list` uses it to map session rows back to mystery titles; `generate-blueprint-images.mjs` / `buildImagePrompt(...)` use it in stable seed phrases and image IDs; `scripts/seed-storage.ts` uploads blueprint JSON as `<id>.json` | Primary external identifier for blueprint files, sessions, and generated assets. |

### `metadata`

| Field                  | Where used now                                                                                                                                                                                                                                  | Notes                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `metadata.title`       | `blueprints-list`; `game-sessions-list`; cover-image prompt generation                                                                                                                                                                          | Player-facing mystery name plus operator image prompt input.                            |
| `metadata.one_liner`   | `blueprints-list` / landing page summary                                                                                                                                                                                                        | Player-facing list summary. No longer used for cover art (replaced by `cover_image.description`). |
| `metadata.target_age`  | Blueprint generator prompt; `game-start`; `game-move`; `game-search`; `game-talk`; `game-ask`; `game-end-talk`; `game-accuse`                                                                                                                   | Shared age-appropriateness input across all runtime narration flows.                    |
| `metadata.time_budget` | `game-start` initializes `game_sessions.time_remaining`; start-event diagnostics                                                                                                                                                                | Determines the initial turn budget.                                                     |
| `metadata.visual_direction` | `buildImagePrompt(...)` for blueprint, character, and location images                                                                                                                                                                      | Structured visual direction (art style, color palette, mood, lighting, texture). Takes precedence over `art_style`. |
| `metadata.art_style`   | `buildImagePrompt(...)` legacy fallback when `visual_direction` is absent                                                                                                                                                                       | Deprecated single-string visual direction. Kept for backwards compatibility.            |
| `metadata.image_id`    | `blueprints-list` exposes it as `blueprint_image_id`; `game-start` attaches it to the first narration part and persists it on the `start` event payload; `blueprint-image-link` validates it; `scripts/seed-storage.ts` seeds referenced assets | Also stripped out of AI blueprint-generation output and patched later by image tooling. |

### `narrative`

| Field                          | Where used now                                                                                  | Notes                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `narrative.premise`            | `game-start` opening narration prompt                                                          | Main hook for story opening. No longer used for cover art (replaced by `cover_image.description`). |
| `narrative.starting_knowledge` | `game-start` formats it as a structured "You already know:" block (mystery summary, locations with characters present, people with summaries) and appends it as a second narrator block persisted on the `start` event payload | Structured object with `mystery_summary`, `locations[]` (referencing `world.locations[].id`), and `characters[]` (referencing `world.characters[].id`). Location names and character names are resolved from `world` at format time. |

### `world`

| Field                        | Where used now                                                                            | Notes                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `world.starting_location_id` | `game-start` sets initial `current_location_id`; returned in the initial `state.location` | Starting point for the session state machine. |

### `cover_image`

| Field                      | Where used now                                                                                                                                  | Notes                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `cover_image.description`  | `buildImagePrompt(...)` for blueprint cover images                                                                                              | AI-authored creative direction for the cover illustration. Generated by the blueprint generator. |
| `cover_image.location_ids` | `buildImagePrompt(...)` for blueprint cover images — location scene references are attached when available                                      | References existing location ids. Can be empty for abstract covers.                             |
| `cover_image.character_ids`| `buildImagePrompt(...)` for blueprint cover images — portrait references are attached when available                                            | References existing character ids. Can be empty for setting/mood-focused covers.                |

### `world.locations[]`

| Field                                 | Where used now                                                                                                                                                                                                  | Notes                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `world.locations[].id`                | All location lookups (`findLocationById`); `game-move` destination validation; `game-search` location matching; session DB `current_location_id`; event payloads                                                | Primary location identifier across all runtime flows.                            |
| `world.locations[].name`              | `game-start` / `game-get` state location lists; `game-move` narration; `game-search` context; talk-context location grounding; location image prompt generation                                                 | Human-readable location label.                                                   |
| `world.locations[].description`       | `game-move` narration; `game-search` search context; talk-context location grounding; accusation-start location context; location image prompt generation                                                       | Shared descriptive text for movement, searching, and conversation framing.       |
| `world.locations[].location_image_id` | `game-move` attaches it to move narration and persists it on move/forced-endgame payloads; `blueprint-image-link` validates it; `scripts/seed-storage.ts` seeds referenced assets                               | Stripped from AI blueprint-generation output and patched later by image tooling. |
| `world.locations[].clues`             | `game-search` location-level clue progression (structured `{id, text, role}`, ID-based tracking of revealed clues, next unrevealed clue for bare search); also available to accusation judging via full blueprint context             | Location-level clues revealed by bare search. At most 1 per location recommended. Roles enable tonal calibration. |
| `world.locations[].sub_locations`     | `game-search` targeted search context (each sub-location provides `id`, `name`, `hint`, `clues` with unrevealed filtering); `game-move` narration (sub-location names passed to prompt so narrator describes searchable areas on arrival); also available to accusation judging via full blueprint context | Searchable areas within each location. Each has a narrator-only `hint` and at most 1 clue. Defaults to `[]` for backward compatibility. |

### `world.characters[]`

| Field                                                      | Where used now                                                                                                                                                                                                                            | Notes                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `world.characters[].id`                                    | All character lookups (`findCharacterById`); `game-talk` character validation; session DB `current_talk_character_id`; event payloads; `game-start` / `game-get` state character lists                                                    | Primary character identifier across all runtime flows.                                            |
| `world.characters[].first_name`                            | `game-start` / `game-get` player-visible character lists; `game-move` destination character summaries and `visible_characters`; `game-talk` / `game-ask` speaker labels; character portrait prompt generation                             | Human-readable character label.                                                                   |
| `world.characters[].last_name`                             | `game-start` / `game-get` player-visible character lists; `game-move` destination character summaries and `visible_characters`; talk-context grounded public character summaries                                                          | Used for public-facing naming.                                                                    |
| `world.characters[].location_id`                           | `game-start` / `game-get` player-visible character positions; `game-move` destination filtering; `game-talk` location validation; talk-context grounded public character summaries                                                        | ID-based link between characters and locations.                                                   |
| `world.characters[].sex`                                   | `game-start` / `game-get` player-visible character lists; `game-move` destination character summaries and `visible_characters`; talk-context grounded public/private character summaries; accusation judging via full blueprint context   | Used to ground narrator/character pronouns and now present on player-visible character summaries. |
| `world.characters[].appearance`                            | `game-move` destination character summaries; talk-context public/private character summaries; character portrait prompt generation                                                                                                        | Public descriptive input for both narration and portraits.                                        |
| `world.characters[].background`                            | `game-move` destination character summaries; talk-context public/private character summaries                                                                                                                                              | Currently used for narration grounding, not portrait generation.                                  |
| `world.characters[].personality`                           | Talk private-character context; character portrait prompt generation                                                                                                                                                                      | Shapes roleplay and portrait vibe.                                                                |
| `world.characters[].initial_attitude_towards_investigator` | Talk private-character context                                                                                                                                                                                                            | Used to ground conversation stance.                                                               |
| `world.characters[].stated_alibi`                          | Talk private-character context; blueprint generator prompt/checks; also available to accusation judging via full blueprint context                                                                                                        | Public claim used to support contradiction-based mysteries.                                       |
| `world.characters[].motive`                                | Talk private-character context; blueprint generator prompt/checks; also available to accusation judging via full blueprint context                                                                                                        | Supports both red herrings and final reasoning.                                                   |
| `world.characters[].is_culprit`                            | Blueprint generator critical check; available to accusation judging via full blueprint context; used by mock accusation evaluation helpers                                                                                                | Runtime narration does not expose this directly to the player.                                    |
| `world.characters[].portrait_image_id`                     | `game-talk` and `game-ask` attach it to narration parts and persist it on event payloads; `blueprint-image-link` validates it; `scripts/seed-storage.ts` seeds referenced assets                                                          | Stripped from AI blueprint-generation output and patched later by image tooling.                  |
| `world.characters[].clues`                                 | Talk private-character context (structured `{id, text, role}`); also available to accusation judging via full blueprint context; referenced by `solution_paths` and `suspect_elimination_paths`                                            | Character-specific mystery clues shared only when relevant topics arise.                          |
| `world.characters[].flavor_knowledge`                      | Talk private-character context; shared freely in conversation to add personality and depth                                                                                                                                                 | Non-mystery worldbuilding facts that enrich roleplay.                                             |
| `world.characters[].actual_actions`                        | Talk private-character context (ordered `{sequence, summary}` timeline); also available to accusation judging via full blueprint context                                                                                                  | Hidden timeline used for character consistency and endgame reasoning.                             |
| `world.characters[].agendas`                               | Talk private-character context; shapes how the narrator AI filters responses through behavioral directives (self-protection, protect-other, implicate-other, conditional-reveal)                                                           | Defaults to `[]` (cooperative witness). Gated clues require specific player actions to unlock.    |
| `world.characters[].clues[].about_character_id`            | Metadata for cross-character clue roles (`alibi_knowledge`, `witness_testimony`, `motive_knowledge`); used by narrator and evaluator                                                                                                     | Optional. References the character the clue is about.                                             |
| `world.characters[].clues[].hint_location_id`              | Metadata for `location_hint` clue role; used by narrator and evaluator                                                                                                                                                                    | Optional. References the location the clue points to.                                             |

### `ground_truth`

| Field                          | Where used now                                                                                     | Notes                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ground_truth.what_happened`   | Available to accusation judging via full blueprint context                                         | Not used in explore/talk/search flows.            |
| `ground_truth.why_it_happened` | Blueprint generator prompt constraints; available to accusation judging via full blueprint context | Canonical explanation of the culprit's reason.    |
| `ground_truth.timeline`        | Blueprint generator prompt/checks; available to accusation judging via full blueprint context      | Endgame reasoning relies on timeline consistency. |

### `solution_paths`

| Field                                    | Where used now                                                                                             | Notes                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `solution_paths[].id`                    | Available to accusation judging via full blueprint context                                                 | Unique identifier for each valid solution chain.                           |
| `solution_paths[].summary`               | Available to accusation judging via full blueprint context                                                 | Human-readable description of the reasoning chain.                         |
| `solution_paths[].location_clue_ids`     | Available to accusation judging via full blueprint context; references `world.locations[].clues[].id`      | Links solution paths to specific location-based clues.                     |
| `solution_paths[].character_clue_ids`    | Available to accusation judging via full blueprint context; references `world.characters[].clues[].id`     | Links solution paths to specific character-based clues.                    |

### `red_herrings`

| Field                                | Where used now                                                                                         | Notes                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `red_herrings[].id`                  | Available to accusation judging via full blueprint context                                             | Unique identifier for each red herring path.                    |
| `red_herrings[].summary`             | Available to accusation judging via full blueprint context                                             | Describes why this evidence trail is misleading.                |
| `red_herrings[].location_clue_ids`   | Available to accusation judging via full blueprint context; references `world.locations[].clues[].id`  | Links red herrings to specific misleading location clues.       |
| `red_herrings[].character_clue_ids`  | Available to accusation judging via full blueprint context; references `world.characters[].clues[].id` | Links red herrings to specific misleading character clues.      |

### `suspect_elimination_paths`

| Field                                              | Where used now                                                                                         | Notes                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `suspect_elimination_paths[].id`                   | Available to accusation judging via full blueprint context                                             | Unique identifier for each suspect elimination path.                     |
| `suspect_elimination_paths[].summary`              | Available to accusation judging via full blueprint context                                             | Describes the evidence chain that clears an innocent suspect.            |
| `suspect_elimination_paths[].location_clue_ids`    | Available to accusation judging via full blueprint context; references `world.locations[].clues[].id`  | Links elimination paths to specific location clues.                      |
| `suspect_elimination_paths[].character_clue_ids`   | Available to accusation judging via full blueprint context; references `world.characters[].clues[].id` | Links elimination paths to specific character clues.                     |

## Current-State Takeaways

- Everything runs on Blueprint V2 with ID-based lookups throughout.
- Shared runtime context is intentionally minimal: only `target_age`.
- Search narration supports two modes: bare search (sequential location-level
  clues) and targeted search (player-guided freeform text judged against
  sub-locations by the AI with GM leeway). Clue roles (`{id, text, role}`)
  enable the narrator to calibrate significance. Sub-locations provide
  narrator-only hints for steering players toward discoverable clues.
- Move narration receives grounded public character summaries (with `id` and
  `location_id`) for the destination location.
- Talk-family endpoints receive the broader location list plus private
  active-character context including structured `clues`, `flavor_knowledge`,
  `actual_actions`, `agendas`, and `player_known_clues` (reconstructed from
  search and ask event payloads across the full game history).
- Character `sex` flows into public character summaries and runtime AI
  contexts so narrator-facing prompts can instruct the model to use grounded
  pronouns instead of inferring them.
- `game-start` remains AI-backed, but `starting_knowledge` (a structured object
  with mystery summary, location summaries, and character summaries) is
  formatted and appended as a non-generated narrator block.
- Accusation framing stays spoiler-safe; accusation judging receives the full
  blueprint including `solution_paths`, `red_herrings`, and
  `suspect_elimination_paths` for evaluating player reasoning quality.
- Session DB stores location and character IDs, not names. Client API requests
  use `character_id` and location ID as `destination`.

## Evaluation Assets And Follow-Up Design Ideas

Current evaluation assets live in the shared package:

- prompt: `packages/shared/src/evaluation/prompt.ts`
- output schema: `packages/shared/src/evaluation/schema.ts`

Those assets target Blueprint V2.

See `docs/blueprint-evaluation.md` for the fuller list.
