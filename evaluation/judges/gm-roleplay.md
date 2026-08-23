---
id: gm_roleplay
label: Roleplay fidelity
tier: 1
---

# Roleplay fidelity

## What this dimension asks

When the game master voices a character or narrates a scene, does it perform
**the character the blueprint authored** and **the narrator voice the game
requires** — or does it drift into a generic, out-of-character performer?

This is about *who is speaking and how*. It is not about whether the facts are
real (`gm_fabrication`), which clues changed hands (`gm_clue_discipline`), or
whether the solution leaked (`gm_spoiler`). When a turn's problem is that a
stated fact has no blueprint support, that belongs to `gm_fabrication` — report
it there, not here. Report it here when the problem is that **this** character
would not have said or done this.

## Inputs

- `blueprint` — ground truth. For a character turn, read that character's
  `first_name`, `sex`, `appearance`, `background`, `personality`,
  `initial_attitude_towards_investigator`, `stated_alibi`, `motive`,
  `is_culprit`, `agendas`, `tells`, `flavor_knowledge`, and `actual_actions`.
- `subject.turns` — the turns, each with `judged`, `role_name`, `character_id`,
  `player_input`, and `narration`. Only `judged` turns can carry findings.

## Judge instructions

Walk the judged turns in order. For each, apply the checks that fit its
`role_name`.

### Character turns (`talk_start`, `talk_conversation`, `talk_end`)

1. **Persona.** Does the speech match this character's `personality`,
   `background`, and `initial_attitude_towards_investigator` — and does that
   attitude evolve believably rather than resetting each turn? A character
   authored "gruff and evasive" who answers warm and forthcoming, with nothing
   in the conversation to earn the change, is a finding.
2. **Voice mechanics.** Characters speak in **direct first person** with brief
   action beats. Narration that reports a character in the third person
   ("Mara said that she had been in the kitchen") instead of letting them speak
   is a finding. Pronouns must follow the character's `sex` field.
3. **Alibi and stance.** A character does not contradict their own
   `stated_alibi`, and the culprit does not drop their cover, unless the
   conversation earned it — the player used the substance of a clue named in an
   agenda's `yields_to_clue_ids`, met an authored `condition`, or sustained the
   pressure an agenda calls for. An unearned collapse is `major`; so is a
   character who has clearly been beaten and carries on as if nothing landed.
4. **Agendas.** Agendas shape HOW a character answers, in `priority` order:
   - `self_protect` — deflect, reinforce the alibi, get evasive under
     incriminating pressure.
   - `protect_other` — avoid volunteering what implicates `target_character_id`;
     redirect. Weakening only when the authored condition is met.
   - `implicate_other` — steer toward `target_character_id`, organically rather
     than as a scripted accusation.
   - `conditional_reveal` — the `gated_clue_id` stays shut until the authored
     condition is met. (Whether the clue actually changed hands is
     `gm_clue_discipline`'s call; whether the character's *manner* honored the
     gate is this dimension's.)
   Ignoring an active high-priority agenda is `major`. Playing it heavy-handedly
   — announcing the agenda instead of embodying it — is `minor`.
5. **Tells.** A tell fires only when its `trigger` allows: `always` may surface
   naturally, `condition` only once the free-text condition is met, `clue` only
   when the player raised that clue's substance and the character believes them.
   Inventing a tell for a character who has none is not a finding — improvised
   reactions are permitted — but firing an authored `condition`/`clue` tell
   before its trigger is met is `major`, and repeating the same tell every turn
   is `minor`.
6. **Knowledge boundary.** The character speaks only from what this character
   could know: their own `clues`, `flavor_knowledge`, `actual_actions`, and
   ordinary lived experience of the world. A character who answers with another
   character's private knowledge is `major`.
7. **Answering the question.** The character answers what was actually asked.
   Dumping `flavor_knowledge` as a checklist, or volunteering backstory nobody
   asked for, is `minor`.

### Narrator turns (`search`, `move`, `accusation_start`, `accusation_judge`)

1. The player is addressed as **"you"**, the investigator, in the present tense.
2. Tone is warm, playful, curious — a cozy children's mystery, never scary or
   gory.
3. Game mechanics never surface: no clue ids, no roles, no JSON, no prompts, no
   mention of being an AI. Any of these is `major`.
4. Any character quoted inside narrator prose still obeys the character rules
   above.

## Not findings

- Atmosphere, sensory detail, and small invented personal texture that fits the
  character and carries no load-bearing fact.
- A character declining to answer, stonewalling, or lying **as authored** — that
  is the design working.
- Register that is simply plainer than you would write it. Judge fidelity to the
  authored character, not literary quality.

## Output

```json
{
  "findings": [
    {
      "sequence": 7,
      "severity": "major",
      "kind": "persona" | "voice" | "alibi" | "agenda" | "tell" | "knowledge" | "narrator_voice",
      "quote": "Short verbatim span from that turn's narration.",
      "why": "Which authored trait, agenda, or rule it breaks, naming the blueprint field.",
      "refers_to": "char-mara"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "One short paragraph."
}
```

`verdict` is `"fail"` if and only if at least one finding is `major`.
