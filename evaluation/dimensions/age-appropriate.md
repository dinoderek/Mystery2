---
id: age_appropriate
label: Age-appropriate language
tier: 1
---

# Age-appropriate language

## What this dimension asks

Is every **player-facing** string in the blueprint written at a reading level
a `metadata.target_age`-year-old can comfortably read unaided?

The game is played by children aged 6–11. The blueprint's authored text is not
just narrator source material: the title and one-liner appear verbatim in the
mystery list, the premise and starting-knowledge summaries appear verbatim in
the in-game notebook, and clue text appears verbatim once discovered. Location
descriptions are the material the runtime narrator is told to stay close to.
Text pitched above the target age breaks the one promise the product makes —
that the player can read the mystery themselves.

This dimension has a deterministic analyzer half: it screens the same strings
with the Flesch–Kincaid grade level and fails clear overshoots mechanically.
The judge's job is what the formula cannot see — unfamiliar vocabulary,
idioms and figurative language, dense or ambiguous phrasing, and words a
child of the target age would not know and cannot work out from context.

## Player-facing fields (judge exactly these)

- `metadata.title`
- `metadata.one_liner`
- `narrative.premise`
- `narrative.starting_knowledge.mystery_summary`
- `narrative.starting_knowledge.locations[].summary`
- `narrative.starting_knowledge.characters[].summary`
- `world.locations[].name` and `world.locations[].sub_locations[].name`
  (shown in the notebook and movement/search narration)
- `world.locations[].description`
- all clue text: `world.locations[].clues[].text`,
  `world.locations[].sub_locations[].clues[].text`,
  `world.characters[].clues[].text`

Everything else — sub-location hints, character backgrounds, personalities,
alibis, tells, flavor knowledge, actual actions, ground truth, image
descriptions — is narrator-only or operator-only material that the runtime
model rewrites under its own age guidance. Do **not** flag it. Character
names are also out of scope: proper nouns are learned, not read for meaning.

Every `findings[].path` must be spelled exactly as listed above with concrete
indices (e.g. `world.locations[0].clues[1].text`) — the validator rejects
paths outside this set.

## Complexity targets per age

The single source of truth is `packages/shared/src/age-profile.ts` (a unit
test keeps this table in sync with it). "Sentence words" is soft guidance for
the longest sentence, not a hard cap. "New words" is how many unfamiliar /
stretch words a passage may introduce, and only when the meaning is clear from
the surrounding text.

| Age | UK year | Sentence words | New words | Vocabulary |
|-----|---------|----------------|-----------|------------|
| 6 | Year 1–2 | 8 | 0 | Use only the most common, everyday words. Almost every word should be one or two syllables. |
| 7 | Year 2–3 | 10 | 1 | Use common, everyday words. |
| 8 | Year 3 | 12 | 1 | Use familiar words. |
| 9 | Year 4 | 14 | 2 | Everyday vocabulary, kept concrete. |
| 10 | Year 5 | 16 | 3 | A broader vocabulary is fine, including unfamiliar words a reader can work out from context. |
| 11 | Year 6 | 18 | 4 | Richer language and the occasional figurative turn of phrase are welcome, as long as the meaning stays clear and vivid. |

## Judge instructions

1. Read `metadata.target_age` and the matching row of the table above. That
   row is your standard for the whole blueprint.
2. Walk every player-facing field listed above. For each string, ask:
   - **Vocabulary** — would a child of the target age know these words, or
     work them out from context within the new-word allowance?
   - **Sentence shape** — are sentences short and direct for the age, or do
     they stack clauses past the soft sentence-word guidance?
   - **Figurative language** — idioms, metaphors, and irony a child of this
     age would misread. (At ages 10–11 the occasional clear figurative turn
     is fine; at 6–8 it is not.)
   - **Clarity** — can the child tell what the clue/summary is actually
     telling them? A clue the player cannot parse is a clue that does not
     exist.
3. Record one `findings[]` entry per problem string: its dotted `path`, a
   short verbatim `quote` of the offending phrase, the `kind` of problem,
   and `why` a target-age reader stumbles. Where the fix is obvious, add a
   `suggestion` in age-appropriate wording.
4. Estimate the reading age of the blueprint's player-facing text as a whole
   (`estimated_reading_age`, a single integer — the age that could
   comfortably read the *hardest* representative passages).
5. Verdict: `"pass"` iff the text as a whole sits at or below the target age
   — a couple of borderline stretch words within the age's new-word
   allowance do not fail the blueprint; a pattern of overshooting
   vocabulary, long stacked sentences, or any clue a target-age reader could
   not understand does.

Content suitability (frightening or mature themes) is out of scope here —
flag it only in `reasoning` if something is glaring, but do not let it drive
the verdict. This dimension measures language complexity.

## Output

```json
{
  "target_age": 8,
  "estimated_reading_age": 10,
  "findings": [
    {
      "path": "world.locations[2].clues[0].text",
      "quote": "an indeterminate quantity of crumbs",
      "kind": "vocabulary" | "sentence_length" | "figurative_language" | "clarity",
      "why": "Short explanation of why a target-age reader stumbles here.",
      "suggestion": "some crumbs"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph. 'pass' iff the player-facing text as a whole reads at or below the target age."
}
```
