# Accusation Flow

## Purpose

Defines the reasoning-first accusation lifecycle used by `game-accuse`, including timeout-forced entry into accuse mode.

## Request Shape

- `game-accuse` accepts:
  - `game_id` (required)
  - `player_reasoning` (optional when entering accuse mode, required for active judge rounds)
- `accused_character_id` is no longer part of the public API contract.

## Flow

1. Explore mode, no `player_reasoning`:
   - Runs `accusation_start`.
   - Transitions session to `mode='accuse'`.
   - Returns narration + `follow_up_prompt`.
2. Explore mode, with `player_reasoning`:
   - Runs first `accusation_judge` round immediately.
   - Judge infers suspect from reasoning/history.
3. Accuse mode, with `player_reasoning`:
   - Runs `accusation_judge` round.
   - `continue` keeps `mode='accuse'`.
   - `win|lose` transitions to `mode='ended'` with final outcome.

## Suspect Inference Rules

- Judge output carries `inferred_accused_character`.
- If suspect is unclear, judge must return:
  - `accusation_resolution='continue'`
  - `inferred_accused_character=null`
  - targeted `follow_up_prompt` asking for suspect clarification.
- Terminal outputs (`win|lose`) must include a non-null inferred suspect.

## Timeout Forced Endgame

- When time reaches zero during `move`, `search`, `talk`, or `ask`:
  - Session transitions to `mode='accuse'`.
  - Backend generates urgency narration through `accusation_start` with `forced_by_timeout=true`.
  - Subsequent inputs use normal `game-accuse` reasoning rounds.

## Event Log Conventions

- `accuse_start`: accusation-mode framing entry.
- `accuse_round`: non-terminal judge round (`continue`).
- `accuse_resolved`: terminal judge outcome (`win|lose`).
- `forced_endgame`: timeout transition into accuse mode from non-accuse endpoints.
