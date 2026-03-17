# Better Blueprints Specification

**Status:** `draft`
**Branch:** `better-blueprints`

<!-- Phase 2 output. The single source of truth for implementation. -->
<!-- This document must be precise enough for any agent to execute against. -->

## 1. Overview

This feature upgrades blueprint authoring from a thin schema-plus-prompt setup into a structured authoring pipeline. The pipeline will generate candidate blueprints from a human brief, validate them against a stronger Blueprint V2 schema, and verify quality through a hybrid oracle: deterministic blocking checks plus AI-based quality review. The goal is to produce mysteries that are coherent, fair, image-ready, and safe to expose to the player without leaking the solution.

The current blueprint contract is too loose for reliable generation and too ambiguous for strong verification. Gameplay functions, image generation, and storage seeding all depend on the same JSON shape, so this feature treats the problem as a storage-contract and tooling upgrade, not just a prompt tweak. Because backward compatibility is explicitly out of scope, the implementation will replace the ambiguous parts of the current blueprint model and update runtime consumers to keep the game functional on the new format.

## 2. Reference Architecture

This feature stays within the approved architecture:

- The browser remains a static SvelteKit client and does not generate or verify blueprints.
- Any model calls for blueprint generation or AI judging run in operator/backend tooling only.
- Blueprint JSON remains the canonical persisted asset in the Supabase Storage `blueprints` bucket and local `blueprints/` directories.

The implementation will follow the repo’s layer boundaries as:

- Entry points: operator scripts in `scripts/` invoked from npm commands.
- Services: reusable blueprint authoring modules for generation, normalization, deterministic verification, and AI judging.
- Repositories: file-system and provider adapters for reading briefs, writing candidate blueprints/reports, and calling OpenRouter.
- Shared contracts: the backend-private blueprint schema in `supabase/functions/_shared/blueprints/` plus any API-facing Zod contracts in `packages/shared` only if a new HTTP boundary is introduced later.

Authoring output flow:

- Human-authored briefs and generated candidates stay local/operator-facing.
- Newly generated candidate blueprints write to `blueprints/drafts/` by default, not directly into the canonical top-level `blueprints/` corpus.
- Promotion from `blueprints/drafts/` into the canonical corpus happens only after deterministic verification and AI review both succeed and the operator accepts the result.

Mistakes intentionally avoided:

- No browser-based blueprint generation UI, because it would violate the server-side AI rule and complicate secrets handling.
- No database-first verification history in this feature, because there is no existing persistence surface for QA reports and local JSON artifacts are sufficient for operator workflows.
- No “prompt only” fix, because the current failures come from weak structure, ambiguous references, and missing visual/public-private separation as much as prompt quality.

## 3. Current State

The current canonical blueprint schema lives in [`supabase/functions/_shared/blueprints/blueprint-schema.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts). It uses ambiguous identity and reference semantics:

- `world.starting_location_id` stores a location name, not a stable location identifier.
- Characters carry both `location` and `location_id`, but both effectively point at the same location name.
- Image generation targets characters by `first_name` and locations by `name`, which is brittle.
- Clues, knowledge, and timeline entries are mostly free-form strings, which limits validation and solvability checks.

Generation guidance is currently under-specified. [`supabase/functions/_shared/blueprints/generator-prompt.md`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/generator-prompt.md) is stale, incomplete, and references fields that do not exist. There is no current end-to-end blueprint generation CLI and no verification oracle in the repo.

The blast radius includes all runtime readers that parse blueprint JSON, especially:

- `supabase/functions/blueprints-list/`
- `supabase/functions/game-start/`
- `supabase/functions/game-get/`
- `supabase/functions/game-move/`
- `supabase/functions/game-talk/`
- `supabase/functions/game-ask/`
- `supabase/functions/game-search/`
- `supabase/functions/game-end-talk/`
- `supabase/functions/game-accuse/`
- `supabase/functions/game-sessions-list/`
- `supabase/functions/blueprint-image-link/`
- `scripts/generate-blueprint-images.mjs`
- `scripts/seed-storage.ts` and `scripts/seed-storage.mjs`
- blueprint JSON fixtures in `blueprints/`
- tests across `tests/api/unit`, `tests/api/integration`, and `web/e2e`

## 4. Design Decisions

### Decision 1: Adopt Blueprint V2 with explicit keys and structured references

**Decided:** Replace ambiguous reference fields with explicit key-based references and structured evidence/timeline data. Blueprint V2 will introduce stable human-readable `character_key` and `location_key` fields, use those keys consistently across references, and remove duplicate or misleading fields such as `location_id` when it means “current location name.” Clues, character knowledge, and timeline entries will move from bare strings to structured objects that separate player-visible text from internal truth and link back to related entities.

Blueprint V2 minimum contract:

- `world.starting_location_key` replaces `starting_location_id`.
- `character_key` and `location_key` are stable human-readable keys or slugs intended for internal references, event payloads, and tooling. They are not opaque UUIDs.
- Blueprint V2 explicitly separates public/player-visible fields, spoiler-safe visual fields, and private solution/evidence fields, instead of mixing them into the same prose blocks.
- Every location has `location_key`, display `name`, player-facing navigation text, and spoiler-safe visual fields.
- Every character has `character_key`, display-name fields, `location_key`, dialogue-driving persona fields, and spoiler-safe visual fields.
- Every clue record includes a stable clue key, the player-facing discovery text, the internal canonical fact, related character/location keys, and acquisition metadata describing how the clue is discovered.
- Every knowledge record includes player-facing dialogue content plus attribution to the speaking character and any related entities.
- Every timeline entry includes order, time label, summary, involved character keys, and related location keys.
- Blueprint V2 includes explicit solve-path metadata identifying which clues are essential, what action surface reveals them (`search`, `talk`, `move`-arrival context, or starting knowledge), and how they support motive, opportunity, contradiction, or means.
- Exactly one culprit is still required, but culprit reasoning must be inferable from the structured evidence chain rather than only from long prose fields.

“Inferable from the structured evidence chain” means Blueprint V2 must encode enough explicit links that a verifier, future judge, or implementation can trace the accusation path without reverse-engineering long paragraphs. At minimum:

- the culprit’s real action sequence must be represented in structured timeline entries tied to character/location keys
- the culprit’s stated alibi must be separately recorded so contradiction checks do not depend on brittle prose matching
- at least one physical or location-based clue must connect the culprit to the relevant place/action
- at least one witness or character-knowledge clue must support or challenge the alibi
- motive must be represented distinctly from action and alibi
- the blueprint must identify which clues are essential to solving the case within the target turn budget, including the action surface used to acquire them

This does not mean the entire solution is reduced to a rigid formal proof. It means the core “opportunity + contradiction + motive” chain is explicit enough for rules and judges to inspect, and explicit enough that future gameplay or evaluation tooling can reason over it without reparsing creative prose.

**Alternatives considered:** Keep name-based identifiers and only improve `.describe()` text; add validation while preserving the current string arrays; use opaque UUIDs for characters and locations; add keys but keep the old duplicate fields for compatibility.

**Rationale:** Strong verification and image generation both depend on unambiguous references. A deterministic oracle cannot reliably verify solvability, contradiction, or spoiler boundaries while core facts remain hidden inside unrelated free-form prose. Human-readable stable keys fit the repo’s existing string-based runtime better than opaque IDs while still giving V2 explicit reference semantics. Since backward compatibility is out of scope, the highest-value choice is to normalize the contract now rather than layering more heuristics on top of an ambiguous schema.

### Decision 2: Add a spoiler-safe visual layer instead of reusing gameplay prose for art

**Decided:** Blueprint V2 will add explicit public visual metadata for the blueprint cover, locations, and characters. This layer will capture art direction, visual anchors, mood/palette/lighting, and spoiler-safe scene or portrait descriptions that are distinct from clue-bearing gameplay prose and ground-truth-only details.

Visual layer minimum contract:

- `metadata` gains structured blueprint-level visual direction rather than a single loose `art_style` string.
- Blueprint cover metadata includes a spoiler-safe concept brief plus required visual anchors.
- Each location includes a static scene description for image generation that excludes hidden clue interpretation.
- Each character includes a static portrait description that excludes culprit-only reveals and investigation-state clues.
- Image-generation utilities must read from these visual fields first and treat gameplay prose only as a fallback-free non-source.

**Alternatives considered:** Continue using `metadata.art_style`, location descriptions, and character appearance strings directly; add only a few optional image prompt fields; generate art from the full blueprint and rely on prompt guardrails.

**Rationale:** The current image prompt builder proves that gameplay prose is too thin for strong visuals and too risky for spoiler leakage. Separating visual presentation from clue-bearing logic makes image generation more consistent, makes spoiler linting tractable, and keeps future prompt iteration independent from gameplay narration.

### Decision 3: Build reusable authoring libraries first, with local operator scripts and `blueprints/drafts/` as the first workflow

**Decided:** Implement generation and verification logic as reusable TypeScript modules called by operator-facing scripts in `scripts/`. The first supported workflow is local/operator-driven authoring that reads a brief, generates a candidate blueprint, runs verification, and writes artifacts to disk. Generated candidates write to `blueprints/drafts/` by default; promotion into the top-level `blueprints/` corpus is a separate operator action after review. Backend exposure is explicitly deferred but kept possible by preserving service/repository boundaries.

**Alternatives considered:** Build generation directly into an Edge Function first; keep everything inside one large script; add a web authoring screen; write generated candidates directly into top-level `blueprints/` with a dry-run mode instead of a drafts directory.

**Rationale:** The repo already favors operator tooling for non-player workflows such as image generation and seeding. Local-first authoring is simpler to test, keeps secrets off the client, avoids introducing a new auth/product surface, and leaves room to move the same services behind backend interfaces later. `blueprints/drafts/` is a safe default because current seed scripts only ingest top-level JSON files and will not accidentally seed nested draft candidates.

### Decision 4: Make deterministic verification the baseline gate and AI judging the required quality-review stage

**Decided:** The verifier has two stages:

- Deterministic gate: required for normal development and CI-relevant usage. It blocks invalid or obviously low-quality blueprints and produces a structured pass/fail report with rule-level findings.
- AI judge stage: also required for authoring-quality review before a generated blueprint is considered ready for the canonical corpus, but it remains excluded from default test/CI paths. It produces structured rubric scores and rationale for coherence, spoiler risk, age fit, fairness, and image readiness.

The deterministic gate is intentionally strong, but its scope is bounded. It should verify what can be checked with high confidence from structure and explicit references, including:

- schema validity and required-field completeness
- exactly one culprit
- unique `character_key`, `location_key`, and clue keys
- all cross-references resolve correctly
- starting location, character locations, and clue locations are valid
- culprit `stated_alibi` and `mystery_action_real` are materially different at the structured level
- culprit timeline, clue placement, and witness knowledge do not obviously contradict each other
- minimum information-depth floors such as location count, suspect count, clue count, and clue diversity
- spoiler linting on public visual/player-visible fields against ground-truth-only facts
- image-readiness structure checks such as required cover/location/character visual metadata
- solvability heuristics such as “required clue chain exists” and “minimum required actions fit within 75% of turn budget”

Deterministic verification must rely on explicit V2 solve-path metadata rather than trying to infer solve requirements from prose. Specifically, the verifier should be able to compute:

- which clues are marked essential versus optional flavor
- which action acquires each essential clue
- whether the essential set contains at least one contradiction path and at least one non-self-authored corroborating clue
- the minimum action count to acquire the essential clue set and enter a supported accusation
- whether that minimum action count fits inside 75% of `metadata.time_budget` under the current runtime cost model

The deterministic verifier should emit rule-level findings grouped as:

- blocking errors: invalid structure, broken references, impossible solve path, or direct public spoiler leakage
- warnings: thin clue diversity, weak suspect spread, marginal time budget, or weak but still technically valid corroboration
- informational notes: quality observations that are not sufficient to block promotion on their own

The deterministic gate is not expected to fully certify narrative quality. It cannot reliably judge:

- whether dialogue and narration feel compelling rather than formulaic
- whether red herrings are subtle instead of obvious
- whether clues feel satisfying for the target age
- whether spoiler risk is low in a nuanced, semantic sense rather than only a rule/lint sense
- whether the overall mystery feels coherent and fair to a human reader once all prose is considered together

Because of those limits, deterministic verification is a baseline safety and structure gate, not the full quality oracle.

**Alternatives considered:** Deterministic-only verification; AI-only scoring; AI verification as a mandatory pre-commit or CI gate.

**Rationale:** Deterministic checks are the only stable default quality gate consistent with the Constitution and `docs/testing.md`, so they should own CI and offline workflows. But deterministic checks alone are not sufficient to judge the actual quality bar the feature wants. The AI judge is therefore required in the authoring workflow, while remaining out of default CI/test paths to preserve determinism and cost control. In practice this means “CI can confirm a blueprint is structurally safe and plausibly solvable,” while “promotion into the curated blueprint corpus requires the additional AI review stage.”

### Decision 5: Use a strict JSON rubric judge in the first cut, while keeping the output shape compatible with future judge splitting

**Decided:** The first implementation will use a single AI judge flow that returns strict JSON with dimension-level scoring and field-path citations. The rubric must cover at least coherence/fairness, spoiler risk, age fit, and image readiness. The judge output schema must be designed so the implementation can later split into separate judges without changing the report contract materially.

First-cut AI judge output minimum contract:

- `judge_version`
- `blueprint_id`
- `dimensions` with named scores and short rationales
- `blocking_findings` and `advisory_findings`
- `promotion_recommendation`
- `citations` that point to field paths, clue keys, character keys, or location keys
- optional `repair_focus` guidance for the operator

**Alternatives considered:** Start with a fully split multi-judge system (`coherence`, `spoiler`, `image-readiness`); use free-form text evaluation; return scores without citations.

**Rationale:** A single strict-JSON rubric judge is the simplest first cut and fits the repo’s existing `generateRoleOutput` pattern. The stronger long-term design may still be multi-judge, especially for spoiler isolation, but that orchestration complexity is not required to ship the first authoring-quality review stage. The important requirement now is structured, cited, machine-parseable output that can fail closed and be upgraded later.

### Decision 6: Keep reports as local JSON artifacts in this feature

**Decided:** Blueprint generation and verification will write machine-readable report artifacts to disk, alongside human-readable console output. No database table or Storage object type will be added for verification history in this feature.

**Alternatives considered:** Add a `blueprint_verification_runs` database table; store reports in Supabase Storage; emit console-only text output with no persisted artifact.

**Rationale:** Local JSON reports satisfy the operator workflow, support future evaluation-harness work, and avoid inventing a persistence model before there is a clear product need. Console-only output is insufficient because future tooling needs structured results; DB/storage persistence is unnecessary scope for the first version.

### Decision 7: Update all runtime consumers to Blueprint V2 instead of supporting dual formats

**Decided:** Runtime functions, image tooling, storage seeding, and tests will be updated to consume Blueprint V2 only. Existing blueprints in the repo will be rewritten to the new shape. There is no compatibility adapter for V1 at runtime.

**Alternatives considered:** Dual-schema runtime support; one-time migration plus compatibility reads; only applying V2 to newly generated blueprints.

**Rationale:** Dual-format support would leak complexity into every gameplay function and image path, exactly where the repo already has the widest blast radius. The project explicitly does not need backward compatibility here, so the simpler and safer long-term state is one canonical blueprint format.

## 5. Implementation Plan

### Phase 1: Schema and shared authoring foundations

- Design Blueprint V2 in `supabase/functions/_shared/blueprints/blueprint-schema.ts`.
- Replace ambiguous identifiers with explicit keys and structured references.
- Add public visual metadata and structured clue/knowledge/timeline entries.
- Add helper validators and normalization utilities for cross-field integrity.

### Phase 2: Generation workflow

- Replace the stale generator prompt with a complete Blueprint V2 generation prompt.
- Add a generation service that takes a brief plus generation options and returns validated Blueprint V2 JSON.
- Add an operator script and npm command for candidate blueprint generation.
- Write generated artifacts to `blueprints/drafts/` by default, with accompanying verification artifacts, without seeding or deploying automatically.

### Phase 3: Verification workflow

- Add deterministic verification rules and a report schema.
- Add an AI judge service that emits strict JSON rubric output for authoring-quality review, while keeping that stage out of default CI paths.
- Add an operator script and npm command for verification reports.
- Ensure deterministic verification can run without network access.

### Phase 4: Runtime and asset pipeline adaptation

- Update gameplay functions, image prompt building, signed-link helpers, and storage seeding to use Blueprint V2 references and visual fields.
- Rewrite repo blueprint fixtures into Blueprint V2.
- Keep player-visible behavior consistent with current game loops while consuming richer underlying blueprint data.

### Phase 5: Tests, docs, and rollout

- Add or update unit, integration, and E2E coverage per the success criteria.
- Update project docs and any operator guidance changed by the new tooling.
- Roll out by replacing the local blueprint corpus and validating the standard non-live quality gates.

Rollback strategy:

- Keep the change isolated to one feature branch until all blueprint fixtures and runtime consumers pass against V2.
- If V2 rollout fails mid-implementation, revert the branch rather than shipping mixed-format runtime support.
- Existing committed blueprints remain recoverable from git history; no runtime fallback adapter will be maintained.

## 6. Constraints

### Must

- Keep the static SvelteKit browser free of blueprint generation, verification, and model-provider secrets.
- Preserve backend-private handling of ground-truth-only blueprint fields and accusation-only spoiler access.
- Keep the game functional for start, move, talk, search, accuse, image rendering, and session listing using Blueprint V2.
- Make deterministic verification runnable offline against local blueprints.
- Require AI judging in the authoring review flow before a generated blueprint is treated as ready for promotion into the canonical corpus.
- Ensure the generation and verification pipeline is reusable from code, not just shell-script glue.
- Surface verification failures with machine-readable output and clear operator diagnostics.
- Enforce a solvability target of resolution within 75% of `metadata.time_budget`.

### Must Not

- Must not add a browser authoring UI in this feature.
- Must not call OpenRouter or any live model from default unit, integration, or E2E test paths.
- Must not preserve or support the old blueprint schema at runtime.
- Must not leak culprit-only or solution-only facts into public visual metadata, blueprint list payloads, or signed image prompts.
- Must not build the future evaluation harness in this feature.
- Must not add verification persistence tables or other new production storage surfaces unless required by a later spec.
- Must not let an unavailable AI judge silently produce a “ready” verdict for blueprint promotion.

### Technology Boundaries

- Use the existing TypeScript, Deno, SvelteKit, Supabase, and OpenRouter stack already approved by the repo.
- Keep the canonical runtime blueprint schema in backend-private code under `supabase/functions/_shared/blueprints/`.
- If new command output contracts are needed, define them with Zod.
- Follow existing script/operator patterns under `scripts/` rather than adding a separate toolchain.
- Keep generated candidates under `blueprints/drafts/` by default and out of the canonical seeded corpus until explicitly promoted.

### Performance & Security

- Deterministic verification of one local blueprint file should run in seconds and must not require network access.
- AI judge workflows must fail closed for authoring review; a provider error cannot silently mark a blueprint as ready for promotion.
- All operator-facing errors must include enough context to identify the failing blueprint, stage, and validation rule.
- Image prompt generation must use only spoiler-safe public visual fields.

## 7. Success Criteria

| Criterion | Verification | Test Tier |
|---|---|---|
| Blueprint V2 rejects ambiguous references, duplicate keys, invalid cross-links, and missing public/private field requirements | Schema parse and validator tests covering valid and invalid fixtures | Unit |
| Deterministic verifier blocks blueprints that violate one-culprit, reference-integrity, contradiction, minimum-depth, spoiler-lint, and solvability rules | Rule tests with fixture blueprints and structured report assertions | Unit |
| Generation workflow can turn a brief into valid Blueprint V2 JSON and emit a persisted candidate/report artifact under `blueprints/drafts/` without manual patching | Generation service tests with mocked provider output and file-write assertions | Unit |
| Image prompt building uses only Blueprint V2 visual metadata and no longer depends on clue-bearing prose for cover/location/character targets | Prompt-builder tests asserting included/excluded fields | Unit |
| All runtime Edge Functions that load blueprints continue to parse, resolve references, and return expected payloads using Blueprint V2 fixtures | Local Supabase integration tests across blueprint list, game start/get/move/talk/search/accuse, sessions list, and blueprint-image-link | Integration |
| Storage seeding and signed image lookup work with Blueprint V2 image IDs and key semantics | Seed and image-link integration tests against local storage | Integration |
| Browser gameplay still supports blueprint selection, session start, navigation, image rendering, and action flows using Blueprint V2 data | Existing high-value browser E2E journeys updated to run against V2 fixtures | E2E |
| AI judge stage emits strict JSON rubric output with dimension scores and citations for authoring review and is required for promotion readiness, while remaining outside default CI/test paths | Mocked AI-judge service tests plus one opt-in live suite path documented outside default CI | Unit / Integration (opt-in live) |

## 8. Documentation Impact

- [ ] `docs/architecture.md` — document the local/operator blueprint authoring and verification pipeline as a backend-safe workflow.
- [ ] `docs/project-structure.md` — add any new blueprint authoring modules, scripts, report output directories, and the `blueprints/drafts/` workflow.
- [ ] `docs/testing.md` — document deterministic verifier coverage, mocked generation coverage, and the opt-in AI judge path.
- [ ] `docs/screen-navigation.md` — no expected change.
- [ ] `docs/component-inventory.md` — no expected change.
- [ ] `docs/styling-conventions.md` — no expected change.
- [ ] Other: `docs/game.md` — refresh the blueprint reference section to describe Blueprint V2 public/private structure and visual metadata expectations.
- [ ] Other: add `docs/blueprint-authoring.md` — operator workflow for writing briefs, generating candidates into `blueprints/drafts/`, reading reports, and promoting blueprints into the canonical corpus.

## 9. Implementation Checklist

- [ ] Task 1: Redesign [`supabase/functions/_shared/blueprints/blueprint-schema.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts) into Blueprint V2, including explicit keys, structured clues/knowledge/timeline entries, and public visual metadata.
- [ ] Task 2: Add cross-field validation and normalization helpers for Blueprint V2 under `supabase/functions/_shared/blueprints/`, with unit fixtures for integrity, contradiction, spoiler checks, and solve-path metadata validation.
- [ ] Task 3: Replace [`supabase/functions/_shared/blueprints/generator-prompt.md`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/generator-prompt.md) and add a reusable generation service plus operator entrypoint for generating candidate blueprints into `blueprints/drafts/` from a brief.
- [ ] Task 4: Add a deterministic verification service, report schema, and operator entrypoint that writes structured verification artifacts to disk.
- [ ] Task 5: Add an AI judge service with strict JSON rubric output, dimension scores, citations, and explicit opt-in execution wiring, without making it part of default tests or CI.
- [ ] Task 6: Update [`scripts/lib/image-prompt-builder.mjs`](/Users/dinohughes/Projects/my2/w1/scripts/lib/image-prompt-builder.mjs) and [`scripts/generate-blueprint-images.mjs`](/Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs) to consume Blueprint V2 visual metadata and key references.
- [ ] Task 7: Update storage seeding and signed image lookup paths, including [`scripts/seed-storage.ts`](/Users/dinohughes/Projects/my2/w1/scripts/seed-storage.ts) and [`supabase/functions/blueprint-image-link/index.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-image-link/index.ts), for Blueprint V2 image references.
- [ ] Task 8: Update session/listing readers such as `blueprints-list`, `game-sessions-list`, `game-start`, and `game-get` to parse Blueprint V2 and preserve public payload behavior.
- [ ] Task 9: Update action-oriented gameplay functions such as `game-move`, `game-talk`, `game-ask`, `game-search`, `game-end-talk`, and `game-accuse` to consume Blueprint V2 evidence, location, and character references without breaking spoiler boundaries.
- [ ] Task 10: Rewrite the local blueprint corpus in [`blueprints/`](/Users/dinohughes/Projects/my2/w1/blueprints) to Blueprint V2 and refresh affected fixtures/tests across unit, integration, and browser E2E suites.
- [ ] Task 11: Update documentation in `docs/` and add authoring guidance for the new generation/verification workflow, including what quality gates are deterministic vs opt-in.

## 10. Open Questions

- Should the first-cut AI judge remain one rubric-based JSON review, or should spoiler review be split into a separate judge immediately if early prompt testing shows poor citation quality or hindsight bias? The spec now chooses the single-judge first cut, but this remains the first likely refinement point.
