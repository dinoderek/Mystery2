# Better Blueprints Specification

**Status:** `refined`
**Branch:** `better-blueprints`

## 1. Overview

This feature replaces the current blueprint contract with Blueprint V2 and adds
an operator-first authoring workflow for generating and reviewing stronger
mystery blueprints.

The goals are:

- generate candidate blueprints from a human-authored brief
- validate them against a more explicit and structured Blueprint V2 schema
- verify them with deterministic checks as the required default gate
- add a first rough AI judge as part of the workflow
- improve text coherence, mystery solvability, and image readiness without
  leaking the solution

This is not a backward-compatible evolution of the current blueprint format.
Blueprint V2 becomes the only supported runtime format for authored blueprints
and for gameplay consumers after rollout.

## 2. Reference Architecture

This feature stays within the approved architecture in
`docs/architecture.md`:

- the browser remains a static SvelteKit client
- blueprint generation, verification, and AI judging remain in operator/backend
  tooling, never in the browser
- blueprint JSON remains the canonical persisted asset in local `blueprints/`
  directories and the Supabase Storage `blueprints` bucket
- secrets remain server-side or operator-local only

Implementation layering:

- entry points: operator scripts under `scripts/`, invoked via npm commands
- services: reusable TypeScript modules for generation, normalization,
  deterministic verification, and AI judging
- adapters: filesystem and model-provider adapters for reading briefs, writing
  artifacts, and calling OpenRouter
- runtime schema: backend-private Blueprint V2 contracts under
  `supabase/functions/_shared/blueprints/`
- UI/backend API contracts: unchanged unless strictly required, and if changed
  must be updated first in `packages/shared/src/mystery-api-contracts.ts`

Out of scope:

- browser blueprint-authoring UI
- DB-backed verification history
- shared multi-user draft editing
- V1/V2 runtime compatibility
- an automated promotion command or promotion workflow

## 3. Current State

The current blueprint schema in
`supabase/functions/_shared/blueprints/blueprint-schema.ts` has four structural
problems:

1. Identity is ambiguous.
   `world.starting_location_id`, `characters[].location`, and
   `characters[].location_id` all behave like location names.
2. Evidence is mostly free-form.
   `locations[].clues`, `characters[].knowledge`, and
   `ground_truth.timeline` are strings, which makes cross-field validation weak.
3. Public, private, roleplay, and visual concerns are mixed together.
4. Runtime session state stores name-based string references that assume
   display-name semantics.

There is also no usable end-to-end blueprint generation workflow in the repo.
The current generator prompt is stale and incomplete, and there is no verifier
or authoring report contract.

The blast radius includes:

- gameplay/runtime readers in `supabase/functions/`
- image-generation utilities in `scripts/`
- local storage seeding
- local blueprint fixtures in `blueprints/`
- tests across unit, integration, and browser E2E

## 4. Refined Decisions

### Decision 1: Blueprint V2 keeps `blueprint.id` as UUID and requires authored stable keys

Blueprint V2 keeps top-level `id` as the canonical UUID because storage object
naming, API requests, and tests already depend on it. Internal entities use
authored stable keys rather than generated normalization.

Rules:

- `blueprint.id` remains a UUID
- the storage object name remains `${blueprint.id}.json`
- Blueprint V2 requires authored stable keys for:
  - locations
  - characters
  - evidence items
  - timeline entries
- keys are human-readable slugs, not opaque UUIDs
- keys are unique within their scope and immutable once authored

### Decision 2: Blueprint V2 makes public, private, and visual layers explicit

Blueprint V2 must separate:

- public player-facing content
- private backend-only roleplay and truth content
- spoiler-safe visual metadata

Minimum partition:

- `metadata`
  - public catalog fields such as `title`, `one_liner`, `target_age`,
    `time_budget`
  - blueprint-level visual direction and optional cover `image_id`
- `narrative`
  - player-visible premise and starting knowledge only
- `world`
  - locations and characters with stable keys and public display data
- `evidence`
  - structured discoverable evidence only
- `ground_truth`
  - private solution facts, culprit identity, actual timeline, and canonical
    explanation
- private character roleplay context
  - persona/background/attitude text
  - private alibi
  - private motive

Private means:

- not exposed to the browser
- not exposed in public/player-visible API payloads
- not used for image generation
- allowed in protected backend flows such as narrator/character roleplay,
  deterministic verification, and AI judging

### Decision 3: Public API payloads stay readable; runtime/session storage moves to keys

The UI and public API boundary continue to expose readable display names.
Internal runtime/session/event storage moves to Blueprint V2 keys.

Concrete contract:

- `GameState.locations[].name`, `GameState.characters[].first_name/last_name`,
  `current_location`, and `current_talk_character` remain display-oriented and
  human-readable
- `game_sessions.current_location_id` and
  `game_sessions.current_talk_character_id` keep their current column names,
  but the stored values become `location_key` and `character_key`
- `game_events.payload` should persist both key and display-name fields where
  useful for diagnostics

### Decision 4: Existing sessions and events are not migrated

This feature does not provide V1-to-V2 session or event translation.

Rollout behavior:

- existing blueprint JSON fixtures are rewritten to V2
- existing `game_sessions` and `game_events` rows that depend on V1 name-based
  semantics are unsupported after rollout
- local/dev/test rollout relies on documented manual cleanup of stale
  session/event data
- no scripted cleanup step is required by this feature

### Decision 5: Evidence collapses into one unified discoverable evidence model

Blueprint V2 replaces separate clue and knowledge record types with one unified
discoverable evidence model.

Each evidence item must have:

- `evidence_key`
- one canonical `player_text`
- one canonical internal fact or fact summary suitable for verification
- related character and location keys as applicable
- one or more acquisition paths
- `essential`: boolean

Acquisition rules:

- an evidence item may be discoverable through multiple surfaces
- supported surfaces are `start`, `move`, `search`, and `talk`
- each acquisition path identifies the relevant location key and/or character
  key when needed
- gameplay may paraphrase the evidence when surfaced, but the blueprint stores
  one canonical authored player-facing description

The verifier must be able to identify an essential evidence path that allows an
optimal player to solve the case.

### Decision 6: Deterministic verification is the required default gate

Deterministic verification is mandatory for all authored or generated blueprints
that are candidates for the canonical corpus.

Blocking rule classes:

- schema validity and required-field completeness
- unique keys and valid cross-references
- exactly one culprit and exactly one valid starting location
- public/private field-placement violations
- invalid image-reference structure
- impossible or broken solve path
- direct public spoiler leakage
- essential clue path that exceeds `floor(0.75 * metadata.time_budget)`

Initial hard-coded minimum content thresholds:

- at least 3 locations
- at least 3 characters
- at least 3 discoverable evidence items

These thresholds are part of the first implementation and are not operator
config in this feature.

Warning-level rule classes:

- weak suspect spread
- thin evidence diversity
- essential evidence clustered in one surface
- marginal time-budget headroom

Informational notes:

- style/readability observations that do not block acceptance
- optional polish opportunities

The deterministic verifier must output a structured report with:

- `blueprint_id`
- `status`: `pass`, `warn`, or `fail`
- `blocking_findings`
- `warning_findings`
- `info_findings`
- `computed_metrics`

### Decision 7: Solvability uses the current runtime action-cost model

Deterministic solvability is calculated against the current game
implementation:

- `move` costs 1 turn
- `search` costs 1 turn
- `talk` start costs 1 turn
- each `ask` follow-up costs 1 turn
- `end_talk` costs 0 turns
- entering `accuse` costs 0 turns
- accusation reasoning rounds cost 0 turns

The verifier must:

- assume an optimal player path with no wasted turns
- compute the minimum required action count to collect the essential solve-path
  evidence and reach accuse mode
- require `required_actions <= floor(0.75 * metadata.time_budget)`

If gameplay rules change action costs later, the verifier rules must be updated
in the same change.

### Decision 8: The visual layer is mandatory, structured, and spoiler-safe

Blueprint V2 includes explicit visual metadata for:

- blueprint cover
- each location scene
- each character portrait

Minimum visual requirements:

- blueprint-level art direction with structured fields for:
  - style
  - mood
  - palette
  - lighting_or_atmosphere
- cover concept with summary text and visual anchors
- location scene description with summary text and visual anchors
- character portrait description with summary text and visual anchors
- optional generated `image_id` fields for each asset target

Critical constraints:

- canonical blueprints are valid without generated image assets as long as the
  required visual metadata exists
- image prompt generation may use only the visual layer plus non-spoiler public
  metadata such as title and one-liner
- image prompt generation must not use clue-bearing prose, private roleplay
  fields, private alibi/motive fields, or ground-truth-only fields

### Decision 9: Draft artifacts live under `blueprints/drafts/` as run directories

Operator artifacts are written to timestamped run directories under
`blueprints/drafts/`.

Generation supports multiple candidates from one brief. A single run directory
contains:

- `brief.md`
- one or more candidate blueprint files
- one deterministic report per candidate when verification is run
- one AI judge report per candidate when AI judging is run
- raw model output files when parsing fails

Default layout:

- `blueprints/drafts/<slug>/<run-id>/brief.md`
- `blueprints/drafts/<slug>/<run-id>/candidate-01.blueprint.json`
- `blueprints/drafts/<slug>/<run-id>/candidate-01.deterministic-report.json`
- `blueprints/drafts/<slug>/<run-id>/candidate-01.ai-judge-report.json`
- `blueprints/drafts/<slug>/<run-id>/candidate-01.raw-model-output.txt`

Rules:

- generation never writes directly into top-level `blueprints/`
- generation and verification must not overwrite an existing run directory
- syntactically valid Blueprint V2 output must still be written to drafts even
  when deterministic verification fails
- promotion into top-level `blueprints/` is outside the scope of this feature

### Decision 10: AI judging ships in the first cut as a single rough judge

AI judging is part of the first shipped workflow, but it is a first rough
iteration rather than a final judging architecture.

First-cut AI judge contract:

- single rubric-based judge flow
- strict JSON output validated with Zod
- score dimensions:
  - coherence_fairness
  - spoiler_safety
  - age_fit
  - image_readiness
- output fields:
  - `judge_version`
  - `blueprint_id`
  - `dimension_scores`
  - `blocking_findings`
  - `advisory_findings`
  - `promotion_recommendation`
  - `citations`
  - optional `repair_focus`

The output contract should be shaped so the workflow can later split into
multiple judges, especially a dedicated spoiler judge, without redesigning the
artifact model.

Failure behavior:

- if the judge times out, returns invalid JSON, or the provider fails, the
  command exits non-zero
- stdout/stderr error reporting is sufficient
- the feature does not need to persist a separate failure artifact for judge
  failures

### Decision 11: Promotion remains manual and outside this spec

This feature stops at draft generation and review artifacts.

Rules:

- no `promote` command is required
- no automated promotion policy is required
- operators may manually copy a blueprint into top-level `blueprints/`
- whether to promote despite AI judge findings is an operator decision outside
  the scope of this specification

## 5. Blueprint V2 Contract Requirements

Blueprint V2 does not need every field enumerated in this document, but it must
satisfy these contract-level requirements.

### Metadata

- `id`: UUID
- `title`
- `one_liner`
- `target_age`: positive integer
- `time_budget`: positive integer
- blueprint-level structured visual direction
- optional cover image reference

Blueprint V2 does not need a schema version field.

### Narrative

- player-facing premise/start text
- player starting knowledge only
- no solution-only facts

### World: locations

- `location_key`
- display `name`
- player-facing move/scene description
- search-relevant public context
- spoiler-safe visual description
- optional `location_image_id`

### World: characters

- `character_key`
- display name fields
- current/default `location_key`
- private roleplay-driving persona/background/attitude text
- private alibi
- private motive
- spoiler-safe portrait description
- optional `portrait_image_id`

### Evidence

- unified discoverable evidence records
- `evidence_key`
- canonical player-facing text
- essential solve-path metadata
- links between evidence, acquisition paths, locations, and characters
- no separate private evidence collection in this feature

### Ground Truth

- culprit key
- canonical explanation of what happened
- canonical motive
- structured actual timeline with stable keys
- explicit contradiction-bearing alibi/action data sufficient for verification

## 6. Tooling and Operator Workflow

The first supported workflow is:

1. Author a brief.
2. Generate one or more candidates into `blueprints/drafts/...`.
3. Run deterministic verification.
4. Run AI judge review.
5. Review the artifacts.
6. Manually decide whether any candidate should be copied into top-level
   `blueprints/`.

Minimum operator command surface:

- generation command
- deterministic verification command
- AI-review command or flag

Expected behavior:

- generation must validate candidate output before declaring success
- generation may emit multiple candidates from one brief
- verification must be runnable against any local blueprint path, including
  canonical blueprints
- AI review must be invokable against a local blueprint path without mutating
  the canonical corpus

## 7. Failure Handling and Recovery

### Generation failures

Failure cases include:

- invalid provider output
- schema parse failures
- deterministic validation failures
- filesystem write failures

Required behavior:

- exit non-zero on fatal failure
- write a run directory when enough context exists to do so
- persist raw model output when JSON parsing fails
- persist syntactically valid candidate blueprints even if verification fails
- do not modify canonical blueprints

### Verification failures

- deterministic blocking findings must produce non-zero exit status
- reports must include blueprint path/id, failing stage, and rule identifiers

### AI judge failures

- invalid JSON, timeouts, or provider failures must produce non-zero exit status
- judge failures must not be treated as success
- stdout/stderr error reporting is sufficient

### Runtime failures after V2 rollout

- stale V1-backed sessions are unsupported
- rollout docs and test setup must instruct operators to manually clear old
  session/event data

### Observability

Every operator-stage failure must surface:

- blueprint ID or source path
- run ID when applicable
- failing stage: `generate`, `verify`, or `judge`
- rule ID or provider error class when available

## 8. Constraints

### Must

- keep the browser free of blueprint generation, verification, and
  model-provider secrets
- keep blueprint storage object naming anchored on `blueprint.id`
- keep the public UI/API boundary readable and spoiler-safe
- keep accusation-only truth access backend-private
- make deterministic verification offline-capable
- use Blueprint V2 as the only runtime blueprint format
- clear stale V1 sessions/events through documented manual cleanup rather than
  compatibility logic
- use only visual metadata plus non-spoiler public metadata for image prompt
  generation
- ship a first-cut AI judge as part of the authoring workflow

### Must Not

- must not add a browser authoring UI
- must not call live models in default unit, integration, or E2E paths
- must not silently treat AI-judge failures as success
- must not reuse clue-bearing or culprit-bearing text in image prompts
- must not add verification history tables or other new production persistence
  surfaces
- must not preserve V1 runtime support
- must not require a schema version field in Blueprint V2

### Technology Boundaries

- use the existing TypeScript, Deno, Supabase, SvelteKit, and OpenRouter stack
- keep the canonical schema in `supabase/functions/_shared/blueprints/`
- use Zod for machine-checked output/report contracts
- follow existing `scripts/` patterns for operator tooling

### Performance and Security

- deterministic verification of a single local blueprint should run in seconds
  and require no network
- AI judge flows must fail closed
- signed image access must continue to validate that the requested image is
  publicly referenced by the blueprint
- no player-facing surface may expose private truth or private roleplay fields
- the spec defines no upper bounds for numbers of locations, characters,
  evidence items, or visual anchors

## 9. Success Criteria

| Criterion | Verification | Test Tier |
|---|---|---|
| Blueprint V2 rejects ambiguous references, duplicate keys, invalid cross-links, and invalid public/private placement | schema/validator fixture tests | Unit |
| Deterministic verifier blocks broken solve paths, spoiler leaks, invalid visual metadata, and time-budget violations using the current action-cost model and `floor(0.75 * time_budget)` | rule tests with structured report assertions | Unit |
| Generation workflow writes run-directory artifacts under `blueprints/drafts/`, supports multiple candidates per run, and never mutates top-level `blueprints/` | mocked generation tests with filesystem assertions | Unit |
| Image prompt building uses only V2 visual metadata and allowed non-spoiler public fields | prompt-builder tests with include/exclude assertions | Unit |
| Runtime functions continue to parse V2 blueprints and preserve current player-visible behavior | local Supabase integration tests across list/start/get/move/talk/search/accuse/session flows | Integration |
| Session/event handling works with key-based internal references and readable response payloads | integration tests for V2 session state and event payloads | Integration |
| Storage seeding and signed image lookup work with V2 image references | storage/image-link integration tests | Integration |
| Browser gameplay still supports blueprint selection, session start, movement, talk, search, accuse, and image rendering against V2 fixtures | updated browser E2E journeys | E2E |
| AI judge output is strict JSON, machine-validated, cited, and excluded from default CI gates | mocked judge tests plus one documented opt-in live path | Unit / Integration (opt-in live) |

## 10. Documentation Impact

- [ ] `docs/architecture.md`
  Document the operator-first blueprint authoring and review flow.
- [ ] `docs/project-structure.md`
  Add Blueprint V2 tooling/report locations and `blueprints/drafts/` workflow.
- [ ] `docs/testing.md`
  Document deterministic verifier coverage, V2 runtime coverage, and opt-in
  AI-judge coverage.
