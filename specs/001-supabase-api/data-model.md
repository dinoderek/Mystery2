# Data Model: Supabase API Implementation (001-supabase-api)

**Phase**: 1 — Design  
**Date**: 2026-03-05  
**Branch**: `001-supabase-api`

---

## Entities

### 1. Blueprint (Storage, not DB)

Stored as a JSON file in Supabase Storage (`blueprints/<id>.json`). Schema is defined in `supabase/functions/_shared/blueprints/blueprint-schema.ts`.

| Field                          | Type          | Notes                              |
| ------------------------------ | ------------- | ---------------------------------- |
| `id`                           | `uuid`        | Primary key, embedded in file      |
| `metadata.title`               | `string`      | Display name                       |
| `metadata.one_liner`           | `string`      | Selection screen description       |
| `metadata.target_age`          | `int`         | Age-appropriate content signal     |
| `metadata.time_budget`         | `int`         | Starting turn count                |
| `narrative.premise`            | `string`      | Opening hook for the player        |
| `narrative.starting_knowledge` | `string[]`    | Initial clues shown at game start  |
| `world.starting_location_id`   | `string`      | ID of first location               |
| `world.locations[]`            | `Location[]`  | See Location sub-schema below      |
| `world.characters[]`           | `Character[]` | See Character sub-schema below     |
| `ground_truth.*`               | `object`      | Backend-only; never sent to client |

---

### 2. game_sessions (Postgres table)

The authoritative snapshot of current game state. Updated atomically after each action.

| Column                      | Type          | Notes                                                |
| --------------------------- | ------------- | ---------------------------------------------------- |
| `id`                        | `uuid`        | Primary key, returned as `game_id`                   |
| `blueprint_id`              | `uuid`        | Reference to the blueprint used                      |
| `mode`                      | `text`        | Enum: `explore`, `talk`, `accuse`, `ended`           |
| `current_location_id`       | `text`        | ID of the player's current location                  |
| `current_talk_character_id` | `text?`       | Set when mode = `talk`                               |
| `time_remaining`            | `int`         | Turns remaining                                      |
| `discovered_clues`          | `text[]`      | Array of stable clue IDs already found by the player |
| `outcome`                   | `text?`       | `win` or `loss`; null until `ended`                  |
| `created_at`                | `timestamptz` | Session creation time                                |
| `updated_at`                | `timestamptz` | Last action time                                     |

**Indexes**: `id` (PK)  
**RLS**: Any anonymous caller can insert; can only read/update their own session (by `id` passed in URL — no auth FK for this feature).

---

### 3. game_events (Postgres table)

Append-only event log. One row per player action or system event.

| Column           | Type          | Notes                                                                                                                  |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | Primary key                                                                                                            |
| `session_id`     | `uuid`        | FK → `game_sessions.id`                                                                                                |
| `sequence`       | `int`         | Turn counter, monotonically increasing                                                                                 |
| `event_type`     | `text`        | Enum: `start`, `move`, `search`, `talk_start`, `ask`, `talk_end`, `accuse_start`, `accuse_reasoning`, `forced_endgame` |
| `actor`          | `text`        | `player` or `system`                                                                                                   |
| `payload`        | `jsonb`       | Input data for the event (e.g., destination, question text)                                                            |
| `narration`      | `text`        | Narrator output for this event                                                                                         |
| `clues_revealed` | `text[]`      | Stable clue IDs revealed by this event (may be empty)                                                                  |
| `created_at`     | `timestamptz` | Event timestamp                                                                                                        |

**Indexes**: `session_id` (for history queries), `(session_id, sequence)` unique  
**RLS**: Append-only insert; read restricted to session owner.

---

## State Transitions

```
    [game start] ──────────────────┐
                                   ▼
    time_expires ──► [ accuse ] ◄── [ explore ] ◄──── end_talk ──── [ talk ]
    (forced_endgame)     │              │                                 ▲
                         │              └──── talk ───────────────────────┘
                    accuse/reasoning
                   (outcome != null)
                         │
                         ▼
                     [ ended ]
```

**Validation rules**:

- `move`, `search`, `talk`, `accuse` only valid in `explore` mode
- `ask`, `end_talk` only valid in `talk` mode
- `accuse/reasoning` only valid in `accuse` mode
- No actions valid in `ended` mode (except `GET /game/{id}` for state retrieval)
- `time_remaining = 0` in `explore` mode: system emits a `forced_endgame` event and transitions to `accuse` mode with an appropriate narrative prompt — the player must still complete the accusation flow

---

## Clue IDs

Clues are identified by a **stable ID** generated server-side when a blueprint is first loaded. The ID is a deterministic hash (e.g., SHA-256 truncated to 8 hex chars) of the clue's text content, prefixed by its source context:

```
clue_<8-char-hex>   e.g. "clue_3fa82c1d"
```

This means:

- The same clue text always produces the same ID across sessions and restarts
- `game_sessions.discovered_clues` stores a plain **`text[]`** of these IDs
- `game_events.clues_revealed` stores the same **`text[]`** of IDs
- To display clue text to the player, the client fetches the full blueprint (or the Edge Function resolves it server-side before returning narration)
- No clue text is stored in the DB — only IDs, keeping session rows lean

---

## Conversation Context

For AI continuity within a `talk` session, the last N events for the current `(session_id, current_talk_character_id)` pair are fetched from `game_events` and sent as context to the AI provider. No separate conversation table is needed.
