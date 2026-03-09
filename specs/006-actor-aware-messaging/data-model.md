# Data Model: Actor-Aware Message Rendering

**Feature**: `006-actor-aware-messaging`  
**Date**: 2026-03-09  
**Phase**: 1 - Design

## Overview

This feature adds canonical speaker attribution to backend narration payloads and UI-rendered message blocks, while separating persisted game history from client-only system feedback.

## Core Entities

### 1. Speaker

Canonical speaker descriptor attached to every renderable message.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `kind` | enum | `investigator`, `narrator`, `character`, `system` | Required |
| `key` | string | Stable machine key (`you`, `narrator`, `system`, `character:<slug>`) | Required; non-empty |
| `label` | string | Player-facing actor label (`You`, `Narrator`, `System`, character name) | Required; non-empty |

Relationship: one `Speaker` is attached to one `MessageBlock` and referenced by response/state schemas.

### 2. MessageBlock (UI stream line)

Single displayed message entry in the terminal stream.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `text` | string | Rendered body text | Required; non-empty |
| `speaker` | Speaker | Actor metadata used for label + style | Required |
| `origin` | enum | `backend` or `local` | Required |
| `persisted` | boolean | Whether the message exists in backend history | `true` only for backend events |

Relationship: many message blocks appear in UI sequence order.

### 3. HistoryEntry (persisted)

Server-returned historical narration line from game state.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `sequence` | integer | Monotonic ordering within session | Required; >0 |
| `event_type` | string | Domain action marker (`start`, `move`, `talk`, etc.) | Required |
| `narration` | string | Persisted event narration | Required; non-empty |
| `speaker` | Speaker | Speaker metadata for this persisted line | Required |

Relationship: many history entries belong to one game session state.

### 4. GameState (speaker-extended)

Server-returned state used to hydrate/resume sessions.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `narration` | string | Current top-level narration | Required |
| `narration_speaker` | Speaker | Speaker for current top-level narration | Required |
| `history` | array<HistoryEntry> | Persisted historical lines only | Required |
| `mode` | enum | `explore`, `talk`, `accuse`, `ended` | Required |

Relationship: one game session has one current state snapshot and many history entries.

### 5. ThemeSpeakerStyleMap

Theme-provided mapping used by the UI renderer.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `speaker_kind` | enum | `investigator`, `narrator`, `character`, `system` | Required |
| `label_style` | string | Theme class/token for speaker label | Required |
| `body_style` | string | Theme class/token for message body | Required |

Relationship: all character speakers share the same `character` style entry for this release.

### 6. LocalSystemFeedback (non-persisted)

Client-generated feedback messages (help/errors/retries) rendered in UI only.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `text` | string | Feedback content | Required; non-empty |
| `speaker` | Speaker | Always system speaker (`kind=system`) | Required |
| `persisted` | boolean | Always `false` | Required |

Relationship: appears in UI stream but never appears in backend `history` from `game-get`.

## Speaker Assignment Rules

| Context | Speaker Kind | Speaker Label |
|--------|---------------|---------------|
| Player typed input line | `investigator` | `You` |
| Start game / move / search narration | `narrator` | `Narrator` |
| Talk question response (`game-ask`) | `character` | Active character name |
| Conversation start (`game-talk`) | `narrator` | `Narrator` |
| Conversation end (`game-end-talk`) | `narrator` | `Narrator` |
| Accusation start/rounds/verdict (`game-accuse`) | `narrator` | `Narrator` |
| Local help/validation/retry/error | `system` | `System` |

## Validation Rules

- Every backend narration payload must include a valid `speaker` object.
- Every `history[]` item returned by `game-get` must include a valid `speaker` object.
- `narration_speaker` must always be present when `narration` is present in game state.
- Local system feedback must not be written into backend event history.
- Character styling is generic by `kind=character`; no per-character style variants in this release.

## State and Flow Notes

```text
UI input submit
  -> append local investigator MessageBlock (persisted=false)
  -> invoke backend endpoint
     -> append backend narration MessageBlock with backend speaker (persisted=true)

Local validation/help/retry
  -> append local system MessageBlock (persisted=false)
  -> no backend write

Session reload (game-get)
  -> hydrate from persisted GameState.history + narration/narration_speaker only
  -> do not include prior local system feedback lines
```

## Scale Assumptions

- Session history remains bounded to normal game-length event volume.
- Speaker metadata adds minimal payload overhead relative to narration text.
- No migration/backfill is required for legacy session formats under this feature scope.
