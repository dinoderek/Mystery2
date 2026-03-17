# Research Findings: Better Blueprints

<!-- Phase 1 output. Produced by synthesis of independent research threads. -->

## Thread Findings

### Thread 1: Project context

- The established architecture puts blueprint authoring, generation, verification, and any secret-bearing AI work on the backend or in operator tooling, not in the browser. The repo already follows this pattern for image generation via local `scripts/` plus server-side runtime AI in Supabase Edge Functions.
- Blueprints are stored as JSON in the `blueprints` Storage bucket and reparsed across gameplay functions. The canonical model is [`supabase/functions/_shared/blueprints/blueprint-schema.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts), and [`docs/game.md`](/Users/dinohughes/Projects/my2/w1/docs/game.md) explicitly treats the schema `.describe()` text as part of the AI instruction layer.
- The current runtime already enforces spoiler boundaries: non-accusation flows do not receive full `ground_truth`, while accusation judging does. Any blueprint-generation or oracle work has to preserve that split, especially for image-related fields and player-visible validation output.
- The current schema is only lightly constrained and uses fragile name-based identity in practice. Location names act as IDs, `starting_location_id` actually stores a location name, and image tooling targets characters by `first_name` and locations by `name`.
- There is no existing blueprint-generation pipeline or verification oracle in the repo. The nearest precedent is the image-generation workflow, which uses local files, local env, deterministic patching, and optional asset deployment.
- Repo constraints are not “none” in practice. The Constitution and [`docs/testing.md`](/Users/dinohughes/Projects/my2/w1/docs/testing.md) require documentation-first work, deterministic default tests, quality gates, and keeping secrets out of the client.

### Thread 2: Codebase impact

- The blast radius is centered on the blueprint storage contract rather than a blueprint database table. Any schema or authoring changes affect authored blueprint JSON, storage seeding, and every runtime function that reparses a blueprint.
- Direct schema/runtime consumers include `blueprints-list`, `game-start`, `game-get`, `game-move`, `game-talk`, `game-ask`, `game-search`, `game-accuse`, `game-end-talk`, `game-sessions-list`, and `blueprint-image-link`, all under [`supabase/functions/`](/Users/dinohughes/Projects/my2/w1/supabase/functions).
- Runtime session and event state is coupled to names, not stable entity IDs. `current_location_id` stores a location name, talk mode stores a character first name, and event payloads persist location/character names. Moving to stable keys would improve correctness but has a wide implementation footprint.
- Image/text alignment already spans schema, scripts, storage seeding, signed-link issuance, and web rendering. Changes to image-facing blueprint fields therefore affect [`scripts/generate-blueprint-images.mjs`](/Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs), related helper modules, runtime edge functions, and web store/image-fetch logic.
- There is no existing persistence surface for verification results. A verifier can exist as a script or internal function without database changes, but durable QA history would require a new table or new storage objects.
- Test impact is large across unit, integration, and E2E layers because the repo validates schema contracts, image prompting, gameplay endpoints, and browser flows end to end.

### Thread 3: Current Blueprint generation

- Current blueprint generation infrastructure is minimal: effectively the Zod schema plus a standalone markdown system prompt in [`generator-prompt.md`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/generator-prompt.md). Research did not find an active code path using that prompt file.
- The current generator prompt is stale and incomplete. Its checklist cuts off mid-sentence and references `true_alibi`, which does not exist in the schema.
- The safest immediate quality improvement is to strengthen schema `.describe()` text and prompt instructions before doing a major schema redesign. Several generation-critical fields are weakly specified or undocumented in practice, including `title`, `id`, `starting_location_id`, location names, character names, `clues`, `knowledge`, `mystery_action_real`, and `timeline`.
- The schema has confusing and possibly redundant location fields today: `starting_location_id` is really a location name in runtime usage, while characters have both `location` and `location_id`. That ambiguity is likely hurting model output quality.
- The best current sample blueprints already follow a repeatable pattern the prompt does not spell out clearly: physical clue in a location, witness/knowledge clue from another character, and a timeline contradiction that makes the culprit provable. Formalizing that pattern is a high-leverage prompt improvement.
- Cross-field validation is currently light. Additional schema refinements for exactly one culprit, valid referenced locations, valid starting location, culprit alibi differing from real action, and minimum content floors would catch many bad generations early.

### Thread 4: Image generation

- The current image prompt builder uses gameplay prose directly: `art_style`, `title`, `one_liner`, `premise`, character `appearance`/`personality`, and location `description`. That is too thin for strong image generation and too risky for spoiler leakage.
- A spoiler-safe visual layer is missing. Current sample blueprints often embed clue-bearing details in `appearance` or `description`, which can leak the answer if reused for portraits, locations, or covers.
- The single free-form `metadata.art_style` field is underpowered. Existing image research already expects mood, lighting, palette, and atmosphere, but most local blueprints do not provide enough of that structure.
- Cover art needs dedicated blueprint fields. The current cover prompt only receives title/premise/one-liner, which is weak for consistent text-image alignment.
- Stable `character_key` and `location_key` identifiers would materially improve image targeting and future-proof prompt/deploy flows. The current first-name/name matching is brittle.
- Separate static scene description from investigation-state/clue text. Static art wants canonical environment and visual anchors; gameplay prose often mixes stable setting with solution-relevant observations.

### Thread 5: Blueprint evaluation oracle

- The current schema is too unstructured for a strong deterministic oracle by itself. Many of the things the product wants to verify, such as solvability, clue sufficiency, or subtle narrative consistency, are implicit in free-form prose rather than explicit fields.
- A deterministic oracle is still the right default hard gate. It can enforce schema validity, one culprit, valid references, duplicate-name checks, culprit-alibi contradiction, minimum information depth, timeline ordering heuristics, and spoiler linting on player-visible fields.
- An AI-based oracle is needed for the parts rules cannot judge well: coherence, fairness, age fit, spoiler subtlety, and image readiness. The best fit is a rubric-driven second stage that returns strict JSON scores plus rationale.
- The strongest AI-oracle design is multi-judge rather than a single “rate this blueprint” prompt: an editor/coherence judge with full access, a spoiler judge limited to player-visible text, and an image judge focused on cover/location/character readiness and spoiler safety.
- The repo’s testing strategy supports this split well: deterministic checks belong in normal quality gates, while model-based oracle runs should remain opt-in like existing live-AI suites.
- Stronger verification likely depends on richer schema structure over time, especially if the team wants to verify explicit clue chains, image safety, and turn-budget solvability with high confidence.

## Cross-Thread Analysis

### Conflicts

- There is a design tension between near-term prompt/schema cleanup and deeper structural cleanup. Given the follow-up decision to ignore backward compatibility and accept large changes, research now points toward the higher-leverage path: cleanup of location fields, stronger validation rules, richer visual metadata, and clearer identifier semantics instead of limiting work to additive compatibility-preserving fixes.
- Placement of future tooling still needs one implementation choice. The research fit is to build the generation/oracle logic as TypeScript libraries first, so they can run from local operator tooling now and be moved behind backend interfaces later without a redesign.

### Reinforcements

- Multiple threads independently found that the current generation stack is too thin: the schema is under-specified, the generator prompt is stale/incomplete, and there is no live generation workflow yet.
- Multiple threads independently found that the current schema mixes identity, prose, and visual concerns in ways that hurt both generation quality and verification strength.
- Multiple threads independently found that image support needs a spoiler-safe visual layer rather than continuing to reuse clue-bearing gameplay prose for art prompts.
- Multiple threads independently found that name-based references are fragile and that stable keys or clarified identifier semantics would materially improve reliability.
- Multiple threads independently found that a hybrid verification model is the strongest fit: deterministic blocking checks first, AI-assisted scoring second, with AI evaluation remaining opt-in rather than a mandatory CI gate.
- Multiple threads independently found that current repo conventions strongly favor operator/backend tooling, schema-centered guidance, and deterministic default tests.

## Problem Reframe

The core problem definition still holds, but it should be updated before specification.

Recommended updates to `problem.md`:

- Replace `Known Constraints: None` with actual project constraints: static SvelteKit client, server-side AI only, blueprints stored as JSON in Supabase Storage, deterministic default test gates, and broad schema blast radius across edge functions/scripts/tests.
- Replace the conflicting backward-compatibility guidance with the clarified decision: backward compatibility is out of scope, and larger structural changes are acceptable if they materially improve blueprint quality and verification.
- Replace “The mystery is always solvable in no more than the X% of the available time” with the concrete target “75% of the available time.”
- Expand “What Good Looks Like” to explicitly include spoiler-safe visual metadata and identifier clarity. Here, “identifier clarity” does not require adding opaque IDs if the project keeps names as identifiers; it means making that contract explicit and consistent: location names and character names must be unique within a blueprint, treated as the canonical references everywhere, and not duplicated through ambiguous parallel fields like `location` vs `location_id`.
- Clarify that the verification oracle is likely hybrid: deterministic checks for required gates, AI-based evaluation for advisory/scored quality dimensions.
- Clarify that the generation/oracle implementation should be built as reusable TypeScript libraries first, with local tooling as the first consumer and a backend move left open for later.

This is not a full reframe, but the specification phase should not proceed until those decisions are reflected in `problem.md`.

## Recommendation Summary

The most promising direction is to treat this as a blueprint-authoring pipeline problem, not just a prompt-tuning problem. Given the decision to ignore backward compatibility, start with stronger schema guidance and validation, repair the generator prompt, remove ambiguous identifier/location field semantics, and add a richer spoiler-safe visual layer instead of limiting work to additive fixes. Build the generation and oracle logic as reusable TypeScript libraries, use local tooling as the first entry point, and add a hybrid verification model with deterministic blocking checks plus an opt-in AI scoring layer for coherence, spoiler risk, and image readiness. That path preserves deterministic quality gates while keeping a clean route to backend adoption later and laying groundwork for a future evaluation harness.
