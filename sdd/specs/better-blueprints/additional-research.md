# Research Findings: Better Blueprints (Additional Research)

<!-- Supplemental Phase 1 research. Focused follow-up on Blueprint V2, deterministic verification, and AI judging. -->

## Thread Findings

### Thread 1: Blueprint V2 format

- The current runtime is tightly coupled to player-facing names rather than stable internal identifiers. [`game-start`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts), [`game-move`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts), [`game-talk`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts), [`game-get`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts), and [`ai-context.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-context.ts) all read or persist location/character references as strings that are effectively display names today.
- Because the DB/session layer already stores string identifiers (`current_location_id`, `current_talk_character_id`) and the web/API boundary still exposes location and character display names via [`packages/shared/src/mystery-api-contracts.ts`](/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts), the lowest-friction V2 identifier approach is stable human-readable keys or slugs, not opaque UUIDs for locations and characters. Opaque IDs would work, but they would widen the blast radius across events, speakers, and debugging output for limited immediate benefit.
- The codebase already uses a public/private data split in practice even though the schema does not express it cleanly. [`blueprints-list`](/Users/dinohughes/Projects/my2/w1/supabase/functions/blueprints-list/index.ts) only needs public metadata, [`blueprint-image-link`](/Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-image-link/index.ts) only needs public image references, and [`ai-context.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-context.ts) only includes `ground_truth` for accusation flows. A viable V2 format should make that split explicit rather than relying on consumers to infer it.
- The current schema mixes at least four concerns into the same text fields: player-visible narration, AI roleplay context, image-generation context, and solver truth. The strongest V2 direction is to separate them into distinct structures:
  - public presentation and player-visible text
  - world-state entities and references
  - private solution/evidence graph
  - spoiler-safe visual metadata
- The existing runtime behavior suggests that V2 should keep display names at the API boundary even if internal references move to keys. The UI currently expects `locations[].name`, `characters[].first_name/last_name`, `current_location`, and `current_talk_character` to be readable strings, so V2 can add keys internally without forcing an immediate public API redesign.
- The current free-form arrays (`locations[].clues`, `characters[].knowledge`, `ground_truth.timeline`) are the main blocker for robust validation. To make V2 meaningfully verifiable, those areas need structured records with explicit references to character/location keys and a clean split between player-visible wording and canonical internal fact.
- The image pipeline confirms that V2 needs a dedicated visual layer. [`scripts/lib/image-prompt-builder.mjs`](/Users/dinohughes/Projects/my2/w1/scripts/lib/image-prompt-builder.mjs) currently builds prompts from `premise`, `description`, `appearance`, and `personality`, which blends stable art direction with clue-bearing prose and creates spoiler risk.
- A local draft directory under `blueprints/` is compatible with the current operator workflow. Both [`scripts/seed-storage.ts`](/Users/dinohughes/Projects/my2/w1/scripts/seed-storage.ts) and [`scripts/seed-storage.mjs`](/Users/dinohughes/Projects/my2/w1/scripts/seed-storage.mjs) only ingest top-level `.json` files in `blueprints/` and `supabase/seed/blueprints/`; they do not recurse into subdirectories. That means `blueprints/drafts/` is a safe default output location for generated candidates and will not be seeded accidentally by existing scripts.

### Thread 2: Deterministic verification rules

- Deterministic verification can be strong, but only if Blueprint V2 makes the solve path explicit. With the current schema, rules can mostly validate shape and obvious contradictions. With V2 structured clue, knowledge, timeline, and visual records, deterministic checks can cover substantially more of the quality bar.
- High-confidence deterministic rules are feasible for:
  - schema validity and required-field completeness
  - unique `character_key`, `location_key`, clue keys, and image IDs
  - valid cross-references between locations, characters, clues, knowledge, timeline entries, and essential-solution fields
  - exactly one culprit and one valid starting location
  - valid public/private field placement and public visual metadata completeness
  - image-reference integrity for cover, location, and portrait assets
  - turn-budget arithmetic based on explicit action costs and required clue path metadata
- Medium-confidence deterministic rules are feasible if V2 encodes evidence relationships explicitly. These include:
  - the culprit’s alibi is contradicted by at least one essential clue
  - the solution path includes at least one physical/location clue and at least one witness/knowledge clue
  - motive, means/opportunity, and contradiction all exist as separate support lines
  - at least one innocent suspect has a plausible motive or suspicious signal
  - essential clues are distributed across more than one action or surface, rather than all collapsing into one obvious reveal
- Low-confidence or non-deterministic quality dimensions remain outside the reliable reach of rules even with a stronger V2:
  - prose coherence across all fields
  - whether red herrings feel subtle rather than forced
  - whether the target age fit is genuinely good rather than superficially compliant
  - whether player-visible text is semantically spoiler-safe rather than only keyword-safe
  - whether the case feels satisfying and fair to a human reader
- The current gameplay cost model makes solvability heuristics more tractable than in a map-based game. From the runtime:
  - `move` costs 1 turn in [`game-move`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts)
  - `search` costs 1 turn in [`game-search`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-search/index.ts)
  - `talk` start costs 1 turn in [`game-talk`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts)
  - each `ask` follow-up costs 1 turn in [`game-ask`](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-ask/index.ts)
  Since movement is currently flat-cost and not graph-based, a deterministic verifier can estimate minimum solve cost if V2 marks which clues are essential and how each is acquired.
- That solvability check still depends on explicit metadata. Without fields like “essential clue,” “discovery surface,” “required action,” or an equivalent solve-path encoding, a deterministic verifier cannot infer with high confidence which clues are mandatory versus optional flavor.
- The most credible deterministic verifier output is not a single pass/fail bit. It should distinguish:
  - blocking errors: invalid structure, broken references, impossible clue chain, obvious spoiler leak
  - strong warnings: weak suspect spread, thin clue diversity, marginal time budget
  - informational notes: non-blocking style or coverage observations
- A purely deterministic oracle is unlikely to be sufficient for accepting blueprints into the canonical corpus. Research from the codebase supports it as a baseline safety/structure gate, not a full quality oracle.

### Thread 3: AI judge structure (prompt, output format)

- The repo already has an established strict-JSON AI pattern. [`ai-provider.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-provider.ts) sends `response_format: { type: "json_object" }` and parses role outputs through explicit validators in [`ai-contracts.ts`](/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/ai-contracts.ts). A blueprint judge should follow the same pattern rather than relying on free-form prose grading.
- The strongest context split is still multi-judge:
  - coherence/fairness judge with full blueprint access
  - spoiler judge restricted to player-visible text and public visual fields
  - image-readiness judge restricted to visual metadata plus non-spoiler public context
  This reduces hindsight bias and makes it easier to reason about what each judge was allowed to see.
- The main trade-off is orchestration cost. Three judges mean more prompts, more failure modes, and more artifacts to aggregate. A single judge prompt with dimension-level scores is simpler to ship first, but it weakens context isolation, especially for spoiler review.
- The highest-value isolation is the spoiler judge. If the first cut does not split all judges, the spoiler review is the one most worth separating because access to full `ground_truth` can make a model over-detect or under-explain spoiler risk from public fields.
- A robust judge output should be evidence-based rather than score-only. The output format should include:
  - `judge_version`
  - `blueprint_id`
  - `dimension_scores` with explicit named dimensions
  - `readiness` or `promotion_recommendation`
  - `blocking_findings`
  - `advisory_findings`
  - `citations` pointing to field paths and stable keys, not long copied prose
  - optional `repair_focus` or `next_actions` for operator use
- A judge that cannot cite specific fields or entity keys will be difficult to trust. The current codebase already relies on machine-checked JSON outputs for runtime AI roles; the same standard should apply here.
- Prompt structure should mirror the current role-output pattern:
  - system prompt defines the judge role, rubric, output contract, and JSON-only requirement
  - user prompt carries the grading objective
  - context payload carries the blueprint or filtered blueprint view as structured JSON
  This is more reliable than stuffing rubric and blueprint into one free-form text prompt.
- The output schema should be strict enough that invalid or incomplete judge output fails closed. Missing dimensions, non-numeric scores, absent findings arrays, or uncited blocking issues should all be treated as invalid judge responses rather than partially accepted output.
- AI judging remains necessary for authoring quality review because it can inspect coherence, fairness, tone, spoiler subtlety, and image readiness at a semantic level that deterministic rules cannot reach reliably.

## Cross-Thread Analysis

### Conflicts

- There is still a design choice between slug-style stable keys and opaque IDs for entities. The repo’s current string-based runtime strongly favors slug-style keys for lower migration cost, but opaque IDs remain a cleaner long-term abstraction if the team is willing to absorb a broader rewrite.
- There is still a design choice between a single rubric-based AI judge and a multi-judge setup. A single judge is simpler to ship; a multi-judge design is stronger, especially for spoiler isolation.
- Deterministic verification can cover a lot of structural ground, but only if V2 carries explicit solve-path metadata. Without that, deterministic checks fall back to being mostly schema and lint validation.

### Reinforcements

- Multiple code paths independently reinforce the need for an explicit public/private blueprint split. Public list/image flows and private accusation flows already behave differently even though the schema does not formalize that separation.
- Multiple runtime consumers independently reinforce that name-based references are a current liability and that V2 needs stable internal keys.
- The current action-cost model independently reinforces that deterministic solvability checks are realistic if the blueprint marks essential clue acquisition paths.
- Existing AI infrastructure independently reinforces that any judge should return strict JSON with parseable fields, not free-form narrative evaluation.
- Existing seeding behavior independently reinforces that `blueprints/drafts/` is a safe local default for generated candidates.

## Problem Reframe

Problem definition confirmed — no reframe needed.

This follow-up research does narrow a few implementation assumptions:

- Blueprint V2 should make the public/private split explicit.
- Deterministic verification should be treated as a baseline structural gate whose strength depends on explicit solve-path metadata.
- AI judging remains necessary for promotion-quality review even if deterministic rules become much stronger.

## Recommendation Summary

The codebase supports a V2 format that keeps readable display names at the API boundary while introducing stable internal keys and explicit public/private structures inside the blueprint. Deterministic verification can do more than schema linting, but only if V2 explicitly models essential clue chains, contradiction support, and acquisition surfaces. The repo’s existing AI contract pattern is a good fit for judge outputs, and spoiler review benefits most from context isolation if the team later decides to split judges. For local workflow, `blueprints/drafts/` is a sound default because existing seed scripts will ignore nested draft files.
