# Story brief reference

> **CURATED EXTRACT — do not edit casually.**
> Sources: `packages/blueprint-generator/src/story-brief.ts`, sizing notes from
> `docs/blueprint-generation-flows.md`
> Source git blob hashes:
> - `packages/blueprint-generator/src/story-brief.ts` — `163a7631efa92fcb7f85101c0cc2040b65a11744`
> - `docs/blueprint-generation-flows.md` — `b5ecaef493d60067d45fb628939254aedb429764`
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
| `artStyle` | no | If present, expand into `metadata.visual_direction`. Do not copy verbatim. The expansion may include the optional `portrait_background` — character-portrait backdrops only, abstract colour/light/blur, never a location from the mystery. |
| `mustInclude` | no | Required ingredients. Each string in this array must appear meaningfully in the blueprint (in clues, descriptions, ground truth, etc). Mechanical check enforces this. |
| `culprits` | no, default 1 | **The blueprint schema requires exactly one culprit** (`is_culprit: true` on exactly one character). If the brief asks for more than 1, treat as 1 — the schema does not currently support multi-culprit mysteries. |
| `suspects` | no | Number of *red-herring suspects*: characters who look guilty but aren't. They should have apparent motive or opportunity but be eliminable through clues. |
| `witnesses` | no | Number of *witness characters*: characters who know something interesting but are not suspects. Generally cooperative. |
| `locations` | no | Exact number of locations to author. Mechanical check enforces this. |
| `redHerringTrails` | no | Number of red-herring plot threads to weave through clues. Mechanical check enforces the `red_herrings[]` count. |
| `coverUps` | no | If `true`, suspects should have cover stories or false alibis — author agendas that lie or omit (`self_protect`, `implicate_other`). |
| `eliminationComplexity` | no | `"simple"` (one clue rules out a suspect) / `"moderate"` (cross-reference 2+ clues) / `"complex"` (must break through an agenda or multi-step reasoning). Affects how `suspect_elimination_paths` are structured. |
| `minPathLength` | no | **Hard floor on solution-path depth.** The shortest route to the culprit must need at least this many distinct, *necessary* clues. Enforced by the `solve_depth` evaluation; falls back to the registry default when unset. |
| `targetPathLength` | no | Solution-path depth the generator should *aim* for. A generation hint only — no judge enforces it. Treat as `>= minPathLength` when both are set. |

## Solution-path depth

`minPathLength` is the one sizing knob that is graded rather than counted, so
it needs deliberate work rather than a tally at the end.

Before you output, trace the *shortest* solution path the way the `solve_depth`
judge measures it:

- Count only clues that are **necessary** — remove a clue and the chain to the
  culprit must break. Redundant corroboration does not add depth.
- Count **distinct** clues. The same clue reached two ways counts once.
- **Every solution path counts, and the shortest one sets the score.** Adding a
  long, elaborate second path does not rescue a two-clue shortcut on the first.

If the shortest path falls short of `minPathLength`, deepen the chain — insert a
genuinely load-bearing intermediate step — rather than padding with extra
corroborating clues.

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

`minPathLength` is a contract too, but a graded one — it is checked by the
`solve_depth` judge rather than a mechanical count, so a blueprint can validate
cleanly and still score badly against it.

## Recommended workflow

1. Read `brief.json` end to end.
2. Inventory: how many of each character type, how many locations, how many
   red-herring trails, which `mustInclude` items, and the required solution-path
   depth (`minPathLength` / `targetPathLength`).
3. Sketch the ground truth (culprit, motive, timeline) before laying out clues.
4. Lay out the reasoning chain to the required depth *before* placing clues, so
   depth is structural rather than retrofitted.
5. Distribute clues across location.clues, sub_location.clues, and
   character.clues so that exploration is broad.
6. Design the clue discovery graph (`requires` gates) — see
   `docs/game-overview.md`. Keep most clues ungated and every solution clue
   reachable from an ungated root.
7. Author agendas in proportion to `eliminationComplexity`.
8. Re-trace the shortest solution path against `minPathLength`. Deepen if short.
9. Validate. Iterate on validation failures.
