# Accusation Flow

## Purpose

Defines the reasoning-first accusation lifecycle used by `game-accuse`, including timeout-forced entry into accuse mode.

## Request Shape

- `game-accuse` accepts:
  - `game_id` (required)
  - `player_reasoning` (optional when entering accuse mode, required for active judge rounds)

## Flow

1. Explore mode, no `player_reasoning`:
   - Runs `accusation_start`.
   - Transitions session to `mode='accuse'`.
   - Returns narration + `follow_up_prompt`.
2. Explore mode, with `player_reasoning`:
   - Runs first `accusation_judge` round immediately.
   - Judge returns `continue|win|lose` directly.
3. Accuse mode, with `player_reasoning`:
   - Runs `accusation_judge` round.
   - `continue` keeps `mode='accuse'`.
   - `win|lose` transitions to `mode='ended'` with final outcome.

## Judge Resolution Rules

- `win` requires naming the true culprit AND one of:
  - an evidence chain following one of the blueprint's `solution_paths` (using
    clues the player actually discovered), or
  - a correct account of what happened — culprit, key sequence of events, and
    motive — matching `ground_truth`, or
  - a confession earned by confronting the accused while already holding most
    of the facts.
  Substance beats wording, but a name-only lucky guess is not a win.
- Wrong or under-supported accusations are rejected with encouragement:
  - `accusation_resolution='continue'`
  - a warm, retry-inviting `follow_up_prompt` that hints at what KIND of fact
    is missing without revealing the answer.
- From round 3 onward a still-failing accusation resolves
  `accusation_resolution='lose'` with a gentle reveal, so a session always
  terminates.
- Terminal outputs (`win|lose`) are authoritative for session outcome.
- The mock provider mirrors these semantics deterministically (wrong suspect →
  `continue` until round 3, then `lose`; true culprit → `win` from round 1).

## Timeout Forced Endgame

- When time reaches zero during `move`, `search`, or `ask`:
  - The triggering action result is stored and returned first.
  - The backend then appends a second `forced_endgame` narration event with urgency framing.
  - Session transitions to `mode='accuse'` with `time_remaining=0` and no active talk target.
  - Subsequent inputs use normal `game-accuse` reasoning rounds.
- `talk` and `end_talk` are narration-bearing but non-time-consuming, so they cannot trigger timeout by themselves.

## Event Log Conventions

- `accuse_start`: accusation-mode framing entry.
- `accuse_round`: non-terminal judge round (`continue`).
- `accuse_resolved`: terminal judge outcome (`win|lose`).
- `forced_endgame`: timeout transition into accuse mode from non-accuse endpoints.
- Narration-bearing `game_events` payloads also include `payload.diagnostics` with session/order/time metadata so timeout ordering and resume defects can be traced without reconstructing hidden state.
