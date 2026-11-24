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
The mechanical `clue_accounting` check already verifies ids exist, were
offered, and are not repeated. Your job is the part code cannot see: **does
the narration's substance, and its notebook line, match the reveal it
recorded?**

## Inputs

- `blueprint.clues` — each with `kind`, `fact`, `source`, and for a
  character's clue how it is `reached`: `first_meeting`, `seen`, `asked`
  (`about`, `prompted_by`) or `gated` (`gate`: `after`, `use`, `line`,
  `physical`). `blueprint.locations.<id>.spots` are the search spots; one with
  `revealed_by` is hidden.
- `subject.turns` — each judged turn carries `revealed_clue_ids` (what it
  recorded), `notebook` (the line saved for each), and
  `prior_revealed_clue_ids` (**authoritative**: what the player held before
  it).

## Judge instructions

For each judged turn, compare the clue's `fact`, the narration, its notebook
line and `revealed_clue_ids`.

1. **Silent reveal** (`kind: "unrecorded"`). The narration delivers the
   substance of a clue — the player now knows the fact, or saw the tell — but
   its id is not in `revealed_clue_ids`. `major`: the player was told
   something their notebook lacks. Paraphrase counts as delivery; *hinting
   that something exists* does not.
2. **Phantom reveal** (`kind: "unsupported"`). A clue id is recorded but the
   narration never conveys its content. `major`.
3. **Distorted clue** (`kind: "distorted"`). The narration delivers a clue
   whose meaning differs from its `fact` — a different object, place, person,
   time or implication — or its notebook line drops or changes a name, time,
   place or object of that fact. `major`. A faithful rewording for a child's
   reading level is correct.
4. **Gate violation** (`kind: "premature"`). A clue delivered before it could
   be reached. Check a gated clue against its `gate`: every `after` clue is
   out (in `prior_revealed_clue_ids`, or taken back by a clue that is), and
   the player used its `use` clues (`any` or `all`) on this character or took
   its `line` of questioning; a gate with only `after` opens on a plain ask.
   Use is what the player's words do, not what they hold (`docs/ai-runtime.md`,
   "Earned, not free"). A bluff stating a clue's substance opens a gate with
   `use` that is not `physical`: that release is earned. A `physical` gate
   needs its `use` clues in `prior_revealed_clue_ids`; released on a bluff,
   `major`. On a search, a hidden spot's clue is early before its
   `revealed_by` clue is held. Any early release is `major`.
5. **Wrong owner** (`kind: "wrong_source"`). A character delivers a clue whose
   `source` is another character or a location, with nothing (their own clues
   or `knows`) giving them that knowledge. `major`.
6. **Withholding an earned clue** (`kind: "withheld"`). The player asked about
   an `asked` clue's `about` with a prompt held, or opened a gate, but the
   character neither delivers the clue nor gives a reason the fiction
   supports. `minor` on a single turn; `major` when the same clue is
   stonewalled across repeated, differently-approached asks, which is how a
   mystery becomes unsolvable. A clue shown and dodged opens on a follow-up.

A `search` turn reveals at most one clue: an evidence clue of the spot its
words name or, naming none, of the room or a visible spot they plainly mean;
or none. Narrating a find that matches no evidence clue there is
a `major` `unsupported` finding; a search that finds nothing adds nothing.

## Not findings

- Reworded, shortened, or age-adjusted clue text, or a notebook line, that
  keeps every name, time, place and object.
- A greeting recording the character's `first_meeting` clues.
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
      "quote": "Short verbatim span from that turn's narration or notebook line.",
      "why": "What the case says and how this turn departs from it.",
      "refers_to": "clue_welly_prints"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`refers_to` should name the clue id at issue whenever there is one. `verdict` is
`"fail"` if and only if at least one finding is `major`.
