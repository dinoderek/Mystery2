# Data Model: Sessions Navigation, Resume, and Completed Logs

**Feature**: `007-sessions`  
**Date**: 2026-03-10  
**Phase**: 1 - Design

## Overview

This feature introduces a session catalog model for landing/list views and formalizes how selected sessions are opened through existing state hydration (`game-get`) into either interactive or read-only viewer modes.

## Core Entities

### 1. SessionSummary

Display-ready row for in-progress or completed lists.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `game_id` | uuid string | Session identifier used for open/resume | Required |
| `blueprint_id` | uuid string | Mystery blueprint identifier tied to session | Required |
| `mystery_title` | string | Title shown in lists (`Unknown Mystery` fallback) | Required; non-empty |
| `mystery_available` | boolean | Whether referenced blueprint metadata is resolvable | Required |
| `can_open` | boolean | Whether the row is selectable | Required |
| `mode` | enum | `explore`, `talk`, `accuse`, `ended` | Required |
| `time_remaining` | integer | Turns remaining at last save | Required; >= 0 |
| `outcome` | enum/null | `win`, `lose`, or null (legacy/unresolved) | Optional/nullable |
| `last_played_at` | ISO datetime string | Derived from `game_sessions.updated_at` | Required |
| `created_at` | ISO datetime string | Session creation time | Required |

Derived fields:

- `category = in_progress` when `mode != ended`
- `category = completed` when `mode == ended`

Openability rule:

- `can_open = false` when `mystery_available = false`
- otherwise `can_open = true`

### 2. SessionCatalogResponse

Aggregated response powering landing and list pages.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `in_progress` | SessionSummary[] | Non-ended sessions sorted by recency | Required |
| `completed` | SessionSummary[] | Ended sessions sorted by recency | Required |
| `counts.in_progress` | integer | Number of in-progress sessions | Required; >= 0 |
| `counts.completed` | integer | Number of completed sessions | Required; >= 0 |

Sort rule (applied independently to both arrays):

1. `last_played_at DESC`
2. `created_at DESC`
3. `game_id DESC`

### 3. LandingMenuState

UI state model for root menu option availability.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `has_in_progress` | boolean | Enables option 2 | Required |
| `has_completed` | boolean | Enables option 3 | Required |
| `selected_option` | enum/null | Current numeric selection | Optional |

Derivation:

- `has_in_progress = counts.in_progress > 0`
- `has_completed = counts.completed > 0`

### 4. SessionListViewState

Route-level state for one category list page.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `category` | enum | `in_progress` or `completed` | Required |
| `rows` | SessionSummary[] | Display rows for this category | Required |
| `empty` | boolean | Empty-state guard | Required |
| `keyboard_back_enabled` | boolean | `b` returns to landing | Required; true |

### 5. SessionViewerMode

Derived mode for `/session` behavior after loading selected `game_id`.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `viewer_mode` | enum | `interactive` or `read_only_completed` | Required |
| `source_session_id` | uuid string | Opened session id | Required |

Derivation from `game-get` state:

- `state.mode == ended` -> `read_only_completed`
- otherwise -> `interactive`

## Relationships

- One authenticated user has many session summaries.
- One `SessionCatalogResponse` contains two disjoint filtered views of the same underlying session set.
- One selected `SessionSummary.game_id` resolves to one `GameState` via `game-get`.
- One `GameState` maps to one `SessionViewerMode`.

## Validation Rules

- Catalog responses must include only sessions owned by authenticated user (RLS + auth).
- Disabled rows (`can_open=false`) must not be openable by numeric selection.
- In-progress list rows must display: title, turns left, last played.
- Completed list rows must display: title, outcome, last played.
- Completed viewer mode must block command input and show only return prompt behavior.

## State Transitions

```text
Landing (/)
  -> select "2" (enabled) -> InProgressList (/sessions/in-progress)
  -> select "3" (enabled) -> CompletedList (/sessions/completed)
  -> select "1" -> existing new-game blueprint flow

InProgressList
  -> select row with can_open=true -> load game-get -> /session (interactive)
  -> key "b" or browser back -> Landing

CompletedList
  -> select row with can_open=true -> load game-get -> /session (read_only_completed)
  -> key "b" or browser back -> Landing

Session viewer (/session)
  -> interactive mode: normal gameplay loop
  -> read_only_completed mode: press any key -> Landing
```
