---
id: gm_clue_discipline
label: Clue release discipline
tier: 1
---

# Clue release discipline

## What this dimension asks

Did the game master hand over **the right clues, at the right time, and record
what it handed over**?

Releasing a clue early skips the work that makes it mean something; releasing
one silently leaves the player's notebook out of step with what they were told.
The mechanical `clue_accounting` check already verifies ids exist, are in
scope, and are not repeated. Your job is the part code cannot see: **does the
narration's substance match the reveal it recorded?**

## Inputs

- `blueprint` — ground truth. Clues live in two places: `world.locations[]`
  (`clues` and `sub_locations[].clues`) and `world.characters[].clues`. Each
  clue has an `id`, a `text`, and optionally `requires.clue_ids` — the
  prerequisite clues that gate it.
- `subject.turns` — each judged turn carries `revealed_clue_ids` (what it
  recorded), `revealed_off_script` (reveals it declared as a deliberate bypass
  of a `requires` gate), `prior_revealed_clue_ids` (**authoritative**: what
  the player already had going into this turn), and, on a character turn,
  `recorded_use` (the gate clues the player used, `used_quote`; absent where
  unrecorded).

## Judge instructions

For each judged turn, compare three things: the clue text in the blueprint, the
narration, and the recorded `revealed_clue_ids`.

1. **Silent reveal** (`kind: "unrecorded"`). The narration delivers the
   substance of a blueprint clue — the player now knows the fact — but that
   clue's id is not in `revealed_clue_ids`. `major`: the player was told
   something their notebook lacks. Paraphrase counts as delivery;
   *hinting that something exists* does not.
2. **Phantom reveal** (`kind: "unsupported"`). A clue id is recorded but the
   narration never conveys its content. `major`.
3. **Distorted clue** (`kind: "distorted"`). The narration delivers a clue whose
   meaning differs from the blueprint's `text` — a different object, place,
   person, or implication. `major`. (A faithful rewording for a child's reading
   level is correct behavior, not a finding.)
4. **Gate violation** (`kind: "premature"`). A clue with `requires.clue_ids` was
   delivered early. From a character, early is before the player has **used**
   its prerequisites; holding them is not enough (`docs/ai-runtime.md`,
   "Earned, not free"). Use is in `recorded_use.used_clue_ids`, this turn or
   earlier, else the player's words. On a search, early is a prerequisite
   missing from `prior_revealed_clue_ids`. Two cases:
   - The turn lists the clue in `revealed_off_script` — a declared bypass. On
     a conversation turn, legitimate when the player's input was genuinely
     clever or a convincing bluff **and** the gate is social/knowledge-shaped;
     `minor` if the input did not earn it; `major` only if the gate is physical
     (a locked safe, a key the player does not have) and cleverness could not
     bypass it. On a search turn the clue sits in a hidden spot: legitimate
     when the search's words name that sub-location, `minor` otherwise.
   - The turn does **not** declare it off-script — an undeclared early release.
     `major`.
5. **Wrong owner** (`kind: "wrong_source"`). A character delivers a clue that
   belongs to another character or to a location the player has not searched,
   with nothing in the blueprint giving them that knowledge (`about_character_id`,
   `hint_location_id`, or their own `clues`). `major`.
6. **Withholding an earned clue** (`kind: "withheld"`). The player asked
   directly, the clue has no prerequisites or the player has used them, and
   no agenda gates it — but the
   character neither delivers it nor gives a reason the fiction supports.
   `minor` on a single turn; `major` when the same clue is stonewalled across
   repeated, differently-approached asks, which is how a mystery becomes
   unsolvable.

For a `search` turn, the game master reveals at most one clue: the next
unrevealed, unlocked clue in the searched location. Narrating a find that
matches no location clue is a `major` `unsupported` finding.

## Not findings

- Reworded, shortened, or age-adjusted clue text that keeps the meaning.
- Atmosphere that carries no clue substance.
- A character hinting they know more, without delivering the content.
- Recalling a clue already in `prior_revealed_clue_ids`: recall, not a new
  reveal, correctly absent from `revealed_clue_ids`.

## Output

```json
{
  "findings": [
    {
      "sequence": 4,
      "severity": "major",
      "kind": "unrecorded" | "unsupported" | "distorted" | "premature" | "wrong_source" | "withheld",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "What the blueprint says and how this turn departs from it.",
      "refers_to": "clue-hall-1"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`refers_to` should name the clue id at issue whenever there is one. `verdict` is
`"fail"` if and only if at least one finding is `major`.
