# Data Model: Action-First Multi-Part Narration

**Feature**: `010-action-first-narration`  
**Date**: 2026-03-16  
**Phase**: 1 - Design

## Overview

This feature makes persisted narration events the canonical transcript source, replaces single-string narration with ordered narration parts, and changes time depletion so the final time-consuming action is recorded before any forced accusation framing is appended.

## Core Entities

### 1. NarrationPart

Smallest player-visible transcript unit.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `text` | string | Player-visible story text | Required; non-empty |
| `speaker` | Speaker | Explicit speaker metadata for this text | Required |
| `image_id` | string or null | Optional image attachment shown with this narration part | Nullable |

Relationship: many `NarrationPart` records belong to one `NarrationEvent`.

### 2. Speaker

Canonical speaker descriptor reused across persisted events and live responses.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `kind` | enum | `investigator`, `narrator`, `character`, `system` | Required |
| `key` | string | Stable machine key | Required; non-empty |
| `label` | string | Player-facing display label | Required; non-empty |

Relationship: one `Speaker` can appear on many `NarrationPart` records.

### 3. NarrationEvent

Persisted event-log record that captures exactly what the player saw for a single gameplay event.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `sequence` | integer | Monotonic event order within session | Required; >0 |
| `event_type` | string | Domain action marker (`start`, `move`, `search`, `talk`, `ask`, `end_talk`, `accuse_start`, `accuse_round`, `accuse_resolved`, `forced_endgame`) | Required |
| `narration_parts` | array<NarrationPart> | Ordered transcript parts for this event | Required; min 1 item |
| `payload` | object | Non-rendered event metadata such as image IDs, prompts, or action context | Optional, endpoint-specific |
| `created_at` | timestamp | Event creation time | Required |

Relationship: many narration events belong to one `GameSession`; each event owns its ordered narration parts.

### 4. GameplayStateSnapshot

Current playable session state returned separately from transcript history.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `mode` | enum | `explore`, `talk`, `accuse`, `ended` | Required |
| `time_remaining` | integer | Remaining turns after the most recently persisted event | Required; >=0 |
| `location` | string | Current location identifier/name | Required |
| `current_talk_character` | string or null | Active conversation target, if any | Nullable |
| `locations` | array<LocationSummary> | Available locations for parsing/display | Required |
| `characters` | array<CharacterSummary> | Known characters and current visible location metadata | Required |

Relationship: one session has one mutable state snapshot and many immutable narration events.

### 5. TurnResponse

Standard response shape for narration-bearing actions after session start.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `narration_parts` | array<NarrationPart> | Ordered transcript parts returned for the requested action, including appended timeout framing when applicable | Required; min 1 item |
| `mode` | enum | Resulting session mode | Required |
| `time_remaining` | integer | Remaining turns after applying the action | Required; >=0 |
| `current_talk_character` | string or null | Updated talk context | Nullable |
| `follow_up_prompt` | string or null | Accusation follow-up prompt when relevant | Nullable |
| `result` | enum or null | Final accusation result for terminal accusation responses | Nullable |

Relationship: returned by move/search/talk/ask/end-talk/accuse endpoints and reflected in later persisted `NarrationEvent` rows.

### 6. SessionTranscriptView

Session load/start response boundary for the browser.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `state` | GameplayStateSnapshot | Playable facts only | Required |
| `narration_events` | array<NarrationEvent> | Persisted transcript history in sequence order | Required |

Relationship: returned by `game-start` and `game-get` to hydrate the browser store.

## Image Attachment Rule

- Image presentation is not part of the gameplay state snapshot itself.
- When an action should show media, the relevant `NarrationPart` carries the `image_id` to render with that specific line.
- Those attachments reference existing blueprint/location/character media associations; the transcript records when an image should be shown, not a separate mutable image state.

## State Transition Rules

### Time Consumption

| Action | Consumes Time | Notes |
|--------|---------------|-------|
| `move` | Yes | Action narration persists before timeout framing |
| `search` | Yes | Action narration persists before timeout framing |
| `ask` | Yes | Character response persists before timeout framing |
| `talk` | No | Starts conversation without reducing time |
| `end_talk` | No | Ends conversation without reducing time |
| `accuse` entry | No | Direct accusation entry remains free |
| `accuse` reasoning rounds | No additional turn cost defined by this feature | Outcome follows existing accusation flow |

### Timeout Transition

```text
Current mode: explore or talk
Requested action: move/search/ask
  -> resolve normal action narration
  -> persist action NarrationEvent
  -> decrement time_remaining and clamp to 0
  -> if time_remaining == 0:
       update session to mode=accuse
       clear current_talk_character
       persist forced_endgame NarrationEvent
       return combined narration_parts in event order
```

### Resume Reconstruction

```text
game-start / game-get
  -> return state snapshot without top-level narration fields
  -> return narration_events in ascending sequence order
Browser store
  -> flatten narration_events[].narration_parts[] in order for rendering
  -> append local-only system/help/retry lines separately
  -> never synthesize transcript lines from fallback narration fields
```

## Validation Rules

- Every narration-bearing response must include at least one narration part.
- Every persisted narration event must include a non-empty ordered list of narration parts.
- Speaker attribution is required on every narration part; clients must not infer missing speakers.
- Any image shown for narration must be attached to the relevant narration part rather than stored as a separate top-level gameplay-state field.
- `forced_endgame` can only appear after a time-consuming action event in the same request flow.
- `time_remaining` may reach zero but must never become negative in returned state.
- When session mode is `accuse` due to timeout, `current_talk_character` must be `null`.
- Local client feedback (`help`, validation, retry, error notices) must never be persisted into `narration_events`.

## Migration Notes

- A database reset is the accepted migration strategy for older sessions.
- The `game_events` persistence shape must be updated so ordered narration parts become first-class stored data.
- Session snapshot responses must stop exposing top-level current narration fields once the new contract is in place.
