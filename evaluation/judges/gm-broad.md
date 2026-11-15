---
id: gm_broad
label: Game master, every question
tier: 1
---

# Game master, every question

## What this dimension asks

Did the game master play the blueprint faithfully, for a child of
`blueprint.metadata.target_age`? One pass asks every question the game-side
judges ask, below, one section per `kind`. Each finding names the section it
answers as its `kind`, and points at one judged turn by its `sequence`.

Report each problem once, under the section that owns it: a stated fact with
no blueprint support is `fabrication`, a character who would not say this is
`out_of_character`, a clue moving wrongly is `clue_handling`, ground truth
given away is `spoiler`, language too hard to read is `not_age_fit`.

## `fabrication`

Did the game master invent material facts, or contradict the blueprint? Fix the
ground truth (locations, `description`s and `sub_locations`; characters'
`background`, `personality`, `stated_alibi`, `motive`, `clues`,
`flavor_knowledge`, `actual_actions`; clue texts), then check each narration's
concrete claims: no characters who do not exist, or placed where the blueprint
contradicts, or given weighty invented relationships; no investigable room or
searchable object that does not exist; no invented events or order of events;
no claim contradicting the blueprint or the game master's own earlier turn.
The test is whether a player could act on it. A character's authored lie is
not fabrication; the narrator asserting the lie as fact is. Player-facing
uncertainty, declining to reveal, and in-character evasion the blueprint's
deception supports are not findings.

`major`: a load-bearing invented or contradicted fact. `minor`: embellishment
that strays past the text but leads nowhere.

## `out_of_character`

Does the game master perform the authored character and the narrator voice?
For character turns (`talk_start`, `talk_conversation`, `talk_end`):

- **Persona**: speech matches `personality`, `background` and
  `initial_attitude_towards_investigator`, and attitude changes only when
  earned.
- **Voice**: direct first person with brief action beats, never reported in
  the third person; pronouns follow `sex`.
- **Alibi and stance**: no contradiction of the character's own `stated_alibi`,
  and no culprit dropping cover, unless earned. Read the agenda's `details`,
  `condition` and `yields_to_clue_ids` as parts; a part is earned when the
  player puts its substance in front of the character, with a clue they hold or
  a specific, plausible bluff or deduction this character would believe.
  Sustained pressure counts only where the agenda calls for it; naming the
  culprit or insisting earns nothing. A full collapse or confession with any
  part unearned is `major`, and so is a character clearly beaten who carries on
  as if nothing landed. A partial crack in answer to a partly earned condition,
  with the alibi kept, is the design working.
- **Agendas**, in `priority` order: `self_protect` deflects and gets evasive;
  `protect_other` avoids implicating `target_character_id`; `implicate_other`
  steers toward its target organically; `conditional_reveal` keeps its manner
  shut until the condition is met. Ignoring an active high-priority agenda is
  `major`; announcing it instead of embodying it is `minor`.
- **Tells**: `always` may surface; `condition` only once met; `clue` only when
  the player raised that clue's substance and the character believes them. A
  `talk_start` greeting comes before the player speaks. An authored tell fired
  early is `major`; the same tell every turn is `minor`; an improvised reaction
  is not a finding.
- **Knowledge**: a character speaking another's private knowledge is `major`.
- **Answering**: dumping `flavor_knowledge` as a checklist, or backstory nobody
  asked for, is `minor`.

Not findings: atmosphere and small invented personal texture that fits the
character and carries no load-bearing fact; a character declining, stonewalling
or lying as authored; a crack, tell or reveal earned by a
convincing bluff or deduction that names the missing evidence's substance;
register plainer than you would write it.

For narrator turns (`search`, `move`, `accusation_start`, `accusation_judge`):
the player is "you", in the present tense; the tone is warm and cozy, never
scary; a surfaced mechanic (a clue id, a role, JSON, a prompt, being an AI) is
`major`. A character quoted in narrator prose obeys the character rules.

## `clue_handling`

Compare each judged turn's narration with the blueprint's clue `text` and its
`revealed_clue_ids`; `prior_revealed_clue_ids` is what the player already had.

- The narration delivers a clue's substance (paraphrase counts, a hint that
  something exists does not) but its id is not recorded: `major`.
- An id is recorded but its content is never conveyed: `major`. A `search` turn
  reveals at most the next unrevealed, unlocked clue of the location; a find
  matching no location clue is `major`.
- A clue delivered with a different meaning (object, place, person,
  implication): `major`. A faithful rewording for a child is correct.
- A clue with `requires.clue_ids` delivered before all are in
  `prior_revealed_clue_ids`: undeclared, `major`; listed in
  `revealed_off_script`, legitimate when the input was genuinely clever and the
  gate is social or knowledge-shaped, `minor` when unearned, `major` when the
  gate is physical.
- A character delivering a clue that belongs to another character or an
  unsearched location, with nothing (`about_character_id`, `hint_location_id`,
  their own `clues`) giving them it: `major`.
- An earned, ungated clue asked for directly and withheld without a fictional
  reason: `minor` once, `major` across repeated, differently-approached asks.

Recalling a clue already held is not a new reveal. Atmospheric description
with no clue substance, and a character hinting they know more without
delivering it, are not findings.

## `spoiler`

Before the accusation, did the game master give away the answer? Only turns
where `is_accusation_phase` is false can carry these findings. Measure against
`ground_truth`, characters' `is_culprit`, `motive` and `actual_actions`, and
`solution_paths`. Ask what a player would know after the turn that they should
have had to earn: the culprit named or effectively confirmed; `why_it_happened`
stated as fact; `what_happened` or the `timeline` retold as fact; an
`actual_actions` entry narrated as what really happened (a character
*claiming* something is fine; the narrator asserting the true version leaks);
the player's reasoning done for them, or a suspect dismissed without an earned
elimination path; a guessed solution element confirmed. Delivering an authored
clue, a character lying or deflecting, tension, foreshadowing, suspicion, a
character's own unreliable theory, and restating what the player found are not
findings.

`major`: a leak the player could act on to skip real investigation, or a
deduction that lands on the culprit. `minor`: one that only narrows the field
or over-summarizes clues the player already has.

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
Look for words the child would not know and cannot work out from context,
sentences that stack clauses well past the guidance, idioms or metaphors a
child this age would misread, and phrasing where the child cannot tell what
they are being told. Stretch words within the allowance are fine. Judge
language complexity only.

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
      "why": "What it breaks, naming the blueprint field, clue, character or standard.",
      "refers_to": "<the clue, character or location id, or blueprint field>"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph covering every section."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
