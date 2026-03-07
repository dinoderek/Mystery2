# Data Model: AI Backend Integration for Narrative Turns

**Feature**: `004-ai-backend-integration`  
**Date**: 2026-03-06  
**Phase**: 1 - Design

## Overview

This feature extends the existing game session/event model with AI role contracts, role-specific context assembly, and iterative accusation rounds while preserving current session ownership and mode transitions.

## Core Entities

### 1. AI Role Definition

Defines one role invocation contract.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `role_name` | enum | `talk_start`, `talk_conversation`, `talk_end`, `search`, `accusation_start`, `accusation_judge` | Required; unique per role |
| `prompt_template` | string | Static role prompt content | Required; non-empty |
| `input_contract_version` | string | Version of allowed context shape | Required |
| `output_contract_version` | string | Version of expected output shape | Required |
| `allows_full_ground_truth` | boolean | Whether full solution context can be attached | True only for `accusation_judge` |

Relationship: One role definition is referenced by many AI invocations in events.

### 2. AI Interaction Context

Runtime context assembled for one AI call.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `game_id` | uuid | Session identifier | Required |
| `role_name` | enum | Role being executed | Must match AI Role Definition |
| `mode` | enum | `explore`, `talk`, `accuse`, `ended` | Required |
| `location_name` | string \| null | Current location | Required for talk/search roles |
| `character_name` | string \| null | Active character for talk roles | Required for talk roles |
| `player_input` | string \| null | User message/accusation reasoning | Required for conversational or accusation judge rounds |
| `conversation_history` | array | Prior relevant turn fragments | Ordered oldest->newest |
| `shared_mystery_context` | object | Non-sensitive world context (title, locations, characters, target age) | Required |
| `ground_truth_context` | object \| null | Full mystery truth context | Only present for accusation judge after accusation start |

Relationship: Generated from `game_sessions`, `game_events`, and blueprint data.

### 3. AI Narrative Response

Validated result returned by AI before persistence.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `narration` | string | Player-visible response text | Required; non-empty |
| `accusation_resolution` | enum \| null | `win`, `lose`, `continue` for accusation judge | Required for judge role |
| `follow_up_prompt` | string \| null | Follow-up question to player during accusation rounds | Required when `accusation_resolution=continue` |

Relationship: Stored as part of one `game_events` row payload + narration.

### 4. Accusation Session State (extension of `game_sessions` semantics)

Tracks accusation stage and resolution progress.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `mode` | enum | Existing game mode | `accuse` indicates accusation stage active |
| `accusation_stage` | enum \| null | `start`, `judging`, `resolved` | Only present while accusation flow is active |
| `outcome` | enum \| null | `win`, `lose` once resolved | Must be null until resolved |

Relationship: One game session has many accusation rounds in `game_events`.

### 5. Accusation Round Event (in `game_events`)

Represents one iterative accusation judge exchange.

Inherited unchanged from existing `game_events` model: `session_id`, `sequence`, `narration`, and `event_type` ordering semantics.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `event_type` | enum | `accuse_start`, `accuse_round`, `accuse_resolved` | Required |
| `payload.player_reasoning` | string \| null | Reasoning submitted this round | Required for `accuse_round` |
| `payload.judge_result` | enum \| null | `win`, `lose`, `continue` | Required for judge events |

Relationship: Many rounds belong to one game session.

### 6. Live AI Execution Profile

Configuration used by live suites and runtime profile selection.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `profile_name` | enum | `default`, `cost_control` | Required |
| `provider_name` | string | Provider routing value (OpenRouter) | Required |
| `model_id` | string | Model identifier | Required; non-empty |
| `enabled_for_live_tests` | boolean | Whether profile participates in live suites | Required |

Relationship: Used by test harness and provider factory; not exposed to players.

### 7. Investigator Script Case

Deterministic scripted flow used in live regression.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `case_id` | string | Script fixture identifier | Required; unique |
| `blueprint_id` | uuid | Mystery fixture used in run | Required |
| `steps` | array | Ordered command inputs and expected checkpoints | Required; non-empty |
| `max_turns` | int | Expected turn budget for successful completion | Required; >0 |

Relationship: One script case is executed across both live profiles.

## Validation Rules

- Non-accusation roles must reject context containing full ground truth fields.
- Every AI output must pass role-specific schema validation before session/event mutation.
- Failed/invalid AI output must produce retriable error response and no terminal state update.
- `mode` transitions must continue through `validateTransition` guard and remain deterministic.
- Accusation resolution must only set session `outcome` when judge result is `win` or `lose`.

## State Transitions

```text
explore
  ├─ talk_start -> talk
  ├─ search -> explore | accuse (on turn exhaustion)
  ├─ accuse_start -> accuse (accusation_stage=start)
  └─ move -> explore | accuse (on turn exhaustion)

talk
  ├─ ask -> talk
  └─ end_talk -> explore

accuse
  ├─ accuse_judge (continue) -> accuse (accusation_stage=judging)
  └─ accuse_judge (win/lose) -> ended (accusation_stage=resolved, outcome set)

ended
  └─ read-only retrieval
```

## Data Volume / Scale Assumptions

- Typical session event history remains small enough for full ordered retrieval in interactive gameplay.
- Live-AI regression executes a single deterministic script case per profile by default.
- Two runtime profiles are maintained concurrently; additional profiles are out of scope.
