# Blueprint V2 Reasoning Structure

## Summary

This plan introduces a schema-breaking v2 of the mystery blueprint so the
reasoning structure is explicit rather than inferred from free-form clue text.

The main goal is to make the blueprint generator, evaluator, accusation judge,
and narrator prompts all operate on the same first-class model of:

- the real solution path
- red-herring paths
- suspect-elimination paths
- location-clue and character-clue intent
- character flavor knowledge
- actual hidden character actions during the mystery window

This should reduce ambiguity, improve solvability, simplify evaluation, and
make runtime narration more consistent with the authored mystery logic.

## Proposed Changes

### 1. Make reasoning paths first-class blueprint data

Add explicit hidden reasoning structures to the blueprint schema:

- `solution_paths[]`
- `red_herrings[]`
- `suspect_elimination_paths[]`

Each path should have:

- `id`
- `summary`
- optional `description`
- `location_clue_ids[]`
- `character_clue_ids[]`

This moves the case logic out of implicit prose and into explicit authored
structure.

The path type is implicit from the array it belongs to:

- `solution_paths[]`
- `red_herrings[]`
- `suspect_elimination_paths[]`

### 2. Replace bare clue and knowledge strings with structured objects

Replace:

- `world.locations[].clues: string[]`
- `world.characters[].knowledge: string[]`

with structured objects that include:

- `id`
- `text`
- `role`

For characters, split the current `knowledge` concept into:

- `world.characters[].clues`
- `world.characters[].flavor_knowledge`

`world.characters[].clues` should use the same structured clue object shape as
location clues.

`world.characters[].flavor_knowledge` should be a separate non-mystery
attribute for optional character/world detail that is not intended to carry case
logic.

This gives the generator and runtime a declared intent for each mystery-relevant
clue while keeping flavor explicitly separate.

### 3. Require location clues to link to authored reasoning

Every location clue must connect to at least one of:

- a real-solution path
- a red-herring path
- a suspect-elimination path

This should be a schema requirement, not just prompt guidance.

`dead_end` and `irrelevant` should not be authored roles. Those remain
evaluator findings when the authored structure is weak or inconsistent.

### 4. Separate character clues from character flavor knowledge

Characters should have two distinct buckets:

- `clues[]` for mystery-relevant facts the character can reveal
- `flavor_knowledge[]` for optional worldbuilding or relationship detail

Only `clues[]` participate in mystery reasoning, evaluator checks, and path
linkage. `flavor_knowledge[]` exists to preserve character texture without
creating ambiguity about whether an item matters to the case.

### 5. Add explicit hidden “actual actions” for each character

Add a hidden factual field for what each character was really doing during the
mystery window.

This should be separate from:

- `stated_alibi` as a public claim
- `mystery_action_real` as a broad summary field

The goal is to reduce ambiguity between:

- what the character says
- what the character actually did
- what the timeline says happened

This should improve both evaluation and accusation judging.

### 6. Standardize clue role taxonomy

Use one shared role vocabulary across schema, generator, evaluator, and
runtime:

- `direct_evidence`
- `supporting_evidence`
- `suspect_elimination`
- `red_herring`
- `red_herring_elimination`
- `corroboration`

This gives all systems one common interpretation of why a clue exists.

## Generator Changes

### 1. Make reasoning structure primary in the generator prompt

Update the generator prompt so it must design the mystery in this order:

1. hidden truth
2. culprit path
3. innocent-suspect elimination paths
4. red-herring paths
5. per-character actual actions
6. location-clue and character-clue distribution
7. flavor pass

The key change is that the reasoning structure must be locked before prose
polish.

### 2. Require explicit path resolution output

The generator should emit:

- at least one real solution path
- one or more red-herring paths when relevant
- one or more suspect-elimination paths

Each red herring must include:

- why it looks suspicious
- the real in-world cause
- how it is resolved

Each suspect-elimination path must include:

- which suspect is ruled out
- which facts rule them out

### 3. Require explicit clue-to-path mapping

The generator should explicitly map:

- every location clue to one or more reasoning paths
- every character clue to one or more reasoning paths

This mapping should be part of the generated blueprint, not an inferred
byproduct.

`flavor_knowledge[]` should be generated separately and should never be used as
a substitute for character clues.

## Runtime Narrator Changes

### 1. Search prompts should use structured clue intent

Update search runtime context so it passes clue objects rather than only clue
text.

The search narrator should:

- reveal the clue faithfully
- describe what is observed
- avoid overstating meaning
- preserve whether the clue supports the real case, a red herring, or
  elimination logic

### 2. Talk prompts should use structured character clues

Update talk runtime context so it passes:

- structured character clues
- separate flavor knowledge
- actual hidden character actions
- stated alibi as a claim

The talk narrator should:

- answer from the character’s perspective
- preserve intended lies, omissions, and misleading behavior
- avoid promoting flavor knowledge as key evidence

### 3. Accusation judge should reason against explicit paths

Update accusation judging to evaluate the player’s reasoning against:

- solution paths
- red-herring resolution paths
- suspect-elimination paths

This should replace the current reliance on reconstructing the case from
free-form prose alone.

### 4. Limit runtime rollout scope

For the first implementation pass, use the new reasoning structure in:

- `search`
- `talk_start`
- `talk_conversation`
- `talk_end`
- `accusation_judge`

Do not broaden the change to all narration roles unless needed later.

## Additional Recommendations

- Add stable ids for characters and locations instead of relying on names as
  implicit keys.
- Revisit `location_id` so the schema has one canonical reference model.
- Keep hidden reasoning structures out of player-facing API responses.
- Update evaluation docs and evaluator schema assumptions in parallel with the
  blueprint revision.
- Treat this as a clean schema break and migrate fixtures, local blueprints, and
  tests together.

## Test Plan

- Schema unit tests for:
  - valid reasoning paths
  - valid clue and knowledge linkage
  - valid flavor-only knowledge
  - invalid unlinked location clues
  - invalid non-flavor unlinked knowledge
  - invalid path references
- Generator tests for:
  - updated structured output schema
  - required path-generation prompt instructions
  - rejection of malformed path/link output
- AI context and prompt tests for:
  - structured search clue context
  - structured talk knowledge context
  - accusation judge access to explicit reasoning paths
- Runtime contract tests to ensure:
  - external responses remain player-safe
  - hidden reasoning structures improve adjudication without leaking spoilers
- Documentation checks:
  - `docs/blueprint-generation-flows.md`
  - `docs/ai-runtime.md`
  - `docs/blueprint-evaluation.md`

## Assumptions

- This is a deliberate schema-breaking v2 change.
- Path objects are preferred over clue-only metadata.
- Flavor knowledge remains allowed, but must be explicit.
- `dead_end` and `irrelevant` remain evaluator outputs, not authored schema
  roles.
- The first rollout should improve generation and talk/search/judge reasoning
  without attempting a full runtime redesign.
