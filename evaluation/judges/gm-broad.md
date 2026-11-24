---
id: gm_broad
label: Game master, every question
tier: 1
---

# Game master, every question

## What this dimension asks

Did the game master play the case faithfully, for a child of
`blueprint.metadata.target_age`? One pass asks every game-side question;
each finding names its section as its `kind`
and one judged turn by its `sequence`.

Report each problem once, in its section: an unsupported fact
is `fabrication`, a character who would not say this `out_of_character`, a clue
moving wrongly `clue_handling`, a secret given away `spoiler`, language too
hard `not_age_fit`.

## `fabrication`

Authored are every clue's `fact`, `truth.timeline`, `truth.motive`,
`opening.facts`, each location's `name`, `facts` and spot names, and each
character's `name`, `personality`, `demeanor`, `appearance` and `knows`. The
narrator may add scenery and manner. `major`: an invention that could mislead
the investigation (it looks like evidence, or bears on who, when or where); a
contradiction of the case or of earlier narration, even of scenery; moving the
investigator on a turn that moved no one; a character asked about the case,
beyond their clues and `knows`, who answers, guesses, hints, or dodges as if
they knew more, instead of saying plainly they do not know; a closing scene
(`graph_ending`) telling a step of `truth.timeline` wrong, or adding one. A
character telling an authored false statement is correct; the narrator
asserting it is not. `minor`: embellishment that leads nowhere.

## `out_of_character`

For character turns (`graph_talk`, `talk_end`):

- **Persona**: speech matches `personality` and the `demeanor` line for the
  stance (`open`, `guarded` while a false statement stands, `shaken` once one
  is taken back, `cornered` before a confession, `cleared`), changing only
  when earned.
- **Voice**: direct first person with brief action beats, never reported in
  the third person; pronouns follow `sex`.
- **Earned**: a gated clue comes only once its gate opened (the preamble's
  rule; `docs/ai-runtime.md`, "Earned, not free"). The player's words decide
  use; holding, a mere mention, naming the culprit or insisting is not use.
  `major`: a concession or confession beyond the opened gates; a statement
  taken back without the clue whose `takes_back` names it, or a concession
  reversed; going back on an earlier line.
- **Tells**: shown `with` their statement whenever it comes out, or when their
  `subject` comes up; a greeting shows none tied to a `subject` or a later
  statement. One acted out early is `major`,
  the same every turn `minor`.
- **Knowledge**: another character's private knowledge is `major`; reciting
  `knows` as a checklist is `minor`.

Not findings: atmosphere; declining, stonewalling or an authored false
statement; a clue given up on a believable bluff where the gate has `use` and
is not `physical`; plain register.

Narrator turns: the player is "you", in the present tense; the tone is warm
and cozy, never scary; a surfaced mechanic (a clue id, a role, JSON, a prompt,
a stance name, being an AI) is `major`.

## `clue_handling`

Compare each judged turn's narration and `notebook` lines with the clue's
`fact` and `revealed_clue_ids`; `prior_revealed_clue_ids` is what the player
held. Each is `major`:

- a clue's substance delivered (paraphrase counts, a hint that something
  exists does not) but not recorded; or recorded but never conveyed;
- a clue, or its notebook line, with a name, time, place, object or meaning
  changed or dropped (a faithful rewording for a child is correct);
- a gated clue before its gate opened: an `after` clue not held, or its `use`
  clues not used and its `line` not taken; a bluff opens a `use` gate unless
  it is `physical`, whose `use` clues must be held;
- an `asked` clue before a `prompted_by` clue is held; a hidden spot's clue
  before its `revealed_by` clue is held; a search giving more than one clue,
  or a find matching no evidence clue of the spot or place named;
- a character delivering a clue whose `source` is someone or somewhere else.

An earned clue asked for and withheld without a fictional reason is `minor`
once, `major` across repeated, differently-approached asks. Recall of a held
clue, and a greeting's `first_meeting` clues, are not findings.

## `spoiler`

Only turns where `is_accusation_phase` is false; the closing scene never
spoils. The secrets are `truth.timeline`, `truth.motive`, the conclusions'
`text` and every false statement's `why`. `major`: the culprit named or
effectively confirmed; the motive or a timeline step stated as fact (a
character claiming something is fine); the player's reasoning done for them,
landing on the culprit; a guess confirmed, including by a failed accusation's
reply (`graph_accusation_round`). `minor`: a leak that only narrows the field
or over-summarizes held clues. A recorded clue, a confession whose gate
opened, and a reply wording what the engine chose are not findings.

## `not_age_fit`

Can a child of `blueprint.metadata.target_age` comfortably read the narration
unaided? The standard is the target age's row:

| Age | UK year | Sentence words | New words | Vocabulary |
|-----|---------|----------------|-----------|------------|
| 6 | Year 1–2 | 8 | 0 | Use only the most common, everyday words. Almost every word should be one or two syllables. |
| 7 | Year 2–3 | 10 | 1 | Use common, everyday words. |
| 8 | Year 3 | 12 | 1 | Use familiar words. |
| 9 | Year 4 | 14 | 2 | Everyday vocabulary, kept concrete. |
| 10 | Year 5 | 16 | 3 | A broader vocabulary is fine, including unfamiliar words a reader can work out from context. |
| 11 | Year 6 | 18 | 4 | Richer language and the occasional figurative turn of phrase are welcome, as long as the meaning stays clear and vivid. |

"Sentence words" is soft guidance for the longest sentence; "New words" is how
many stretch words a passage may introduce when context makes them clear.
Look for words the child cannot work out from context, sentences stacking
clauses well past the guidance, idioms a child this age would misread, and
phrasing where the child cannot tell what they are being told. Judge language
complexity only.

`major`: a turn that, as a whole, is not comfortable to read at the target
age. `minor`: an isolated overshoot in an otherwise readable turn.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "major" | "minor",
      "kind": "spoiler" | "fabrication" | "clue_handling" | "out_of_character" | "not_age_fit",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "What it breaks, naming the case field, clue, character or standard.",
      "refers_to": "<the clue, character or location id, or case field>"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph covering every section."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
