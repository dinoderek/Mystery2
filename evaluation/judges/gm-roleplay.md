---
id: gm_roleplay
label: Roleplay fidelity
tier: 1
---

# Roleplay fidelity

## What this dimension asks

When the game master voices a character or narrates a scene, does it perform
**the character the case authored** and **the narrator voice the game
asks for** — or does it drift into a generic, out-of-character performer?

This is about *who is speaking and how*, not whether the facts are real
(`gm_fabrication`), which clues changed hands (`gm_clue_discipline`), or whether
the solution leaked (`gm_spoiler`). Report it here when **this** character
would not have said or done this.

## Inputs

- `blueprint.characters.<character_id>` — `name`, `sex`, `personality`,
  `demeanor` (a line per stance), `appearance` and `knows`.
- The character's clues: every `blueprint.clues` entry whose
  `source.character` is theirs, with how it is `reached` and what it
  `takes_back`.
- `subject.turns` — each with `judged`, `role_name`, `character_id`,
  `player_input`, `narration`, `revealed_clue_ids` and
  `prior_revealed_clue_ids`. Only `judged` turns can carry findings.

## Judge instructions

Walk the judged turns in order. For each, apply the checks that fit its
`role_name`.

### Character turns (`graph_talk`, `talk_end`)

1. **Persona** (`persona`). Speech matches the character's `personality` and
   the `demeanor` line for their stance: `open` with no false statement out,
   `guarded` while one stands, `shaken` once one is taken back, `cornered`
   when only a plain question stands between them and a confession, `cleared`
   once every one is taken back. A missing line falls back to a neighbouring
   stance. A guarded character who answers warm and forthcoming, with nothing
   in the conversation to earn it, is a finding.
2. **Voice** (`voice`). Characters speak in **direct first person** with brief
   action beats. Reporting a character in the third person ("Mara said that she
   had been in the kitchen") is a finding. Pronouns follow `sex`.
3. **Earned stance.** Judge each line against the story so far: the
   character's earlier turns and the clues recorded. A character gives up a
   gated clue only once its gate opened, by the preamble's rule
   (`docs/ai-runtime.md`, "Earned, not free"). The player's words decide
   whether a clue was used: its point made and aimed at this character, so
   they could fairly react as if just shown it. Holding or mentioning a clue
   is not use, nor is naming the character culprit, insisting, or a case
   built on other clues.
   - `unearned`: a concession or crack beyond what the opened gates give.
     `major`. (A gated clue itself coming out early, the confession included,
     is `gm_clue_discipline`'s.)
   - `taken_back`: a statement taken back with no clue whose `takes_back`
     names it, or a character denying or reversing what they already
     conceded. `major`.
   - `contradiction`: the character's story going back on an earlier line
     with nothing taking it back (a world fact is `gm_fabrication`'s).
     `major`. Holding to a false statement until its gate opens is the design.
4. **Tells** (`tell`). A tell clue is behaviour, shown `with` its
   statement whenever that comes out, or when its `subject` comes up. A
   greeting shows its `first_meeting` tells and those riding on its first
   words, never one tied to a `subject` or a later statement. Acting out an
   authored tell before its statement or subject came up is `major`; the same
   tell every turn is `minor`; an improvised reaction that hints at no clue is
   not a finding. (Whether a tell
   was recorded is `gm_clue_discipline`'s.)
5. **Knowledge** (`knowledge`). The character speaks only from their own
   clues, `knows`, and ordinary lived experience. Answering with another
   character's `knows` or private knowledge is `major` (another's clue is
   `gm_clue_discipline`'s).
6. **Answering** (`persona`). The character answers what was asked. Reciting
   `knows` as a checklist, or unasked backstory, is `minor`.

### Narrator turns (every other role)

1. The player is addressed as **"you"**, the investigator, in the present tense.
2. Tone is warm, playful, curious — a cozy children's mystery, never scary or
   gory.
3. Game mechanics never surface: no clue ids, no roles, no JSON, no prompts,
   no mention of being an AI. Any of these is `major` (`narrator_voice`).
4. Any character quoted inside narrator prose still obeys the character rules
   above.

## Not findings

- Atmosphere, sensory detail, and small invented personal texture that fits the
  character and carries no load-bearing fact.
- A character declining, stonewalling, or telling a false statement **as
  authored** — that is the design working.
- A gate's clue given up once the gate opened, with the crack the new stance's
  `demeanor` line calls for: proportional yielding is the design working.
- A clue given up on a believable bluff stating what the missing clue proves,
  where the gate has `use` and is not `physical`. Rewarding good roleplay is
  intended.
- Register that is plainer than you would write it. Judge fidelity to the
  authored character, not literary quality.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "major",
      "kind": "persona" | "voice" | "unearned" | "taken_back" | "contradiction" | "tell" | "knowledge" | "narrator_voice",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which authored trait or rule it breaks, naming the case field.",
      "refers_to": "hale"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
