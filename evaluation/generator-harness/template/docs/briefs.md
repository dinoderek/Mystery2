# Story brief reference

> **CURATED EXTRACT — do not edit casually.**
> Sources: `packages/blueprint-generator/src/story-brief.ts`, sizing notes from
> `docs/blueprint-generation-flows.md`
> Source git blob hashes:
> - `packages/blueprint-generator/src/story-brief.ts` — `f6b888fd7a20a87258133319bef3eabf4d33b7f2`
> - `docs/blueprint-generation-flows.md` — `b92ce9cd79d51725342a19daf0d988685aea040b`
> Verifier: `node evaluation/generator-harness/scripts/check-curated-docs.mjs`
> If sources change in ways that affect brief interpretation, regenerate this file.

Your input arrives as a validated `story_brief` JSON object in `./brief.json`
under the `story_brief` key. Every field below is what you should read
literally and respect.

| Field | Required | Meaning |
|---|---|---|
| `brief` | yes | Free-form mystery premise. Treat as creative seed and constraint. |
| `targetAge` | yes | Target reading level. Tones every text field. |
| `timeBudget` | no | If present, use exactly as `metadata.time_budget`. If absent, infer a moderate budget from the brief's complexity. |
| `titleHint` | no | If present, base `metadata.title` on it. |
| `artStyle` | no | If present, expand into `metadata.visual_direction`. Do not copy verbatim. |
| `mustInclude` | no | Required ingredients. Each string in this array must appear meaningfully in the blueprint (in clues, descriptions, ground truth, etc). Mechanical check enforces this. |
| `culprits` | no, default 1 | **The blueprint schema requires exactly one culprit** (`is_culprit: true` on exactly one character). If the brief asks for more than 1, treat as 1 — the schema does not currently support multi-culprit mysteries. |
| `suspects` | no | Number of *red-herring suspects*: characters who look guilty but aren't. They should have apparent motive or opportunity but be eliminable through clues. |
| `witnesses` | no | Number of *witness characters*: characters who know something interesting but are not suspects. Generally cooperative. |
| `locations` | no | Exact number of locations to author. Mechanical check enforces this. |
| `redHerringTrails` | no | Number of red-herring plot threads to weave through clues. Mechanical check enforces the `red_herrings[]` count. |
| `coverUps` | no | If `true`, suspects should have cover stories or false alibis — author agendas that lie or omit (`self_protect`, `implicate_other`). |
| `eliminationComplexity` | no | `"simple"` (one clue rules out a suspect) / `"moderate"` (cross-reference 2+ clues) / `"complex"` (must break through an agenda or multi-step reasoning). Affects how `suspect_elimination_paths` are structured. |

## Character count math

The total `world.characters` count is enforced by the eval pipeline as:

    culprits + suspects + witnesses

If the brief says `culprits: 1, suspects: 2, witnesses: 2`, you must author
exactly 5 characters. The pipeline's mechanical check rejects mismatches.

## Sub-location guidance (not from brief)

The schema requires each location to define 2–4 sub-locations. This is
independent of any brief field but matters because:

- sub-location names are surfaced to the player as searchable areas
- each sub-location can hold at most 1 clue
- some sub-locations should be atmospheric dead ends (no clue)

## Reading the brief

Treat the brief as a *contract*, not a suggestion. Mismatch on `locations`,
`culprits` (always = 1), character total, `redHerringTrails`, or `mustInclude`
will fail mechanical checks regardless of how good the prose is.

## Recommended workflow

1. Read `brief.json` end to end.
2. Inventory: how many of each character type, how many locations, how many
   red-herring trails, which `mustInclude` items.
3. Sketch the ground truth (culprit, motive, timeline) before laying out clues.
4. Distribute clues across location.clues, sub_location.clues, and
   character.clues so that exploration is broad.
5. Author agendas in proportion to `eliminationComplexity`.
6. Validate. Iterate on validation failures.
