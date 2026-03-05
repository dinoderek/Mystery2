# API Contract: Mystery Game Backend (001-supabase-api)

**Phase**: 1 — Design  
**Date**: 2026-03-05  
**Branch**: `001-supabase-api`  
**Source**: `plan/B1-api-contract.md` (authoritative reference)

This document translates the API contract into concrete Supabase Edge Function signatures, request/response schemas, error codes, and state machine guards. All endpoint names are Supabase Edge Function names (i.e., `supabase/functions/<name>/index.ts`).

---

## Conventions

- All requests and responses use `Content-Type: application/json`
- All session-scoped endpoints accept `game_id` as a **path segment** in the URL
- Error responses use `{ "error": "<message>" }` with appropriate HTTP status codes
- HTTP status codes: `200 OK`, `400 Bad Request` (invalid action/state), `404 Not Found` (session/blueprint not found), `500 Internal Server Error`
- The Supabase Edge Function URL shape: `POST /functions/v1/<function-name>`

---

## 1. `blueprints-list` — List Available Blueprints

**Maps to**: `GET /api/blueprints`  
**Method**: `GET`  
**Auth**: None

### Response `200`

```json
{
  "blueprints": [
    {
      "id": "uuid",
      "title": "string",
      "one_liner": "string",
      "target_age": "number"
    }
  ]
}
```

**Implementation notes**:

- Reads from Supabase Storage `blueprints/` bucket
- Parses each `.json` file and returns only public metadata (no `world`, `ground_truth`)

---

## 2. `game-start` — Start a New Game

**Maps to**: `POST /api/game/start`  
**Method**: `POST`  
**Auth**: None

### Request Body

```json
{
  "blueprint_id": "uuid"
}
```

### Response `200`

```json
{
  "game_id": "uuid",
  "state": {
    "locations": [{ "name": "string" }],
    "characters": [
      {
        "first_name": "string",
        "last_name": "string",
        "location_name": "string"
      }
    ],
    "time_remaining": "number",
    "location": "string",
    "mode": "explore",
    "current_talk_character": null,
    "clues": ["string"],
    "narration": "string"
  }
}
```

**Implementation notes**:

- Loads blueprint from Storage, validates with `BlueprintSchema`
- Creates `game_sessions` row + `game_events` row (`event_type: start`)
- Calls AI provider (mock in this feature) to generate opening narration using `narrative.premise`
- `clues` array in state contains `narrative.starting_knowledge` texts
- Returns characters without `mystery_action_real`, `stated_alibi`, `motive`, `is_culprit` (ground truth is never sent)

### Error `400`

```json
{ "error": "Blueprint not found" }
```

---

## 3. `game-get` — Get Current Game State

**Maps to**: `GET /api/game/{game_id}`  
**Method**: `GET`  
**Auth**: None

### URL Path Parameter

- `game_id`: UUID of game session

### Response `200`

```json
{
  "state": {
    "locations": [{ "name": "string" }],
    "characters": [
      {
        "first_name": "string",
        "last_name": "string",
        "location_name": "string"
      }
    ],
    "time_remaining": "number",
    "location": "string",
    "mode": "explore | talk | accuse | ended",
    "current_talk_character": "string | null",
    "clues": ["string (clue ID)"],
    "narration": "string",
    "history": [
      {
        "sequence": "number",
        "event_type": "string",
        "actor": "player | system",
        "narration": "string"
      }
    ]
  }
}
```

**Implementation notes**:

- Reads `game_sessions` snapshot directly (no event replay needed)
- `narration` is the most recent event's narration from `game_events`
- `history` is the full ordered list of `game_events` for this session (ordered by `sequence` ascending), with each entry including `sequence`, `event_type`, `actor`, and `narration`. This gives the client everything it needs to reconstruct the complete scrollable narration view on resume — including dialogue attribution (narrator vs. character vs. player action).

### Error `404`

```json
{ "error": "Game session not found" }
```

---

## 4. `game-move` — Move to a Location

**Maps to**: `POST /api/game/{game_id}/move`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `explore`

### Request Body

```json
{
  "destination": "string (location name)"
}
```

### Response `200`

```json
{
  "narration": "string",
  "current_location": "string",
  "visible_characters": [{ "first_name": "string", "last_name": "string" }],
  "time_remaining": "number"
}
```

**Implementation notes**:

- Validates destination exists in blueprint's `world.locations`
- Deducts 1 turn; if `time_remaining` reaches 0, appends a `forced_endgame` event and transitions mode to `accuse` — the response includes an appropriate narrative transition and the new mode
- Calls AI for arrival narration using location `description`
- Updates `game_sessions.current_location_id` and `time_remaining`

### Error `400`

```json
{ "error": "Invalid destination" }
```

---

## 5. `game-search` — Search Current Location

**Maps to**: `POST /api/game/{game_id}/search`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `explore`

### Request Body

_(empty)_

### Response `200`

```json
{
  "narration": "string",
  "discovered_clue_id": "string | null",
  "time_remaining": "number"
}
```

**Implementation notes**:

- Blueprint's `locations[current].clues` provides the pool of discoverable clues
- Cross-references `discovered_clues` (ID array) in session to avoid duplicates
- AI generates flavour narration; deterministic clue selection from blueprint
- `discovered_clue_id` is the stable clue ID (e.g. `"clue_3fa82c1d"`) or `null` if nothing found
- Deducts 1 turn; appends to `game_events`

---

## 6. `game-talk` — Initiate a Conversation

**Maps to**: `POST /api/game/{game_id}/talk`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `explore`

### Request Body

```json
{
  "character_id": "string"
}
```

### Response `200`

```json
{
  "narration": "string",
  "mode": "talk"
}
```

**Implementation notes**:

- Validates character is present at `current_location_id` in blueprint
- Updates `game_sessions.mode = 'talk'` and `current_talk_character_id`
- AI generates character greeting narration using character `personality` and `initial_attitude_towards_investigator`
- Appends `talk_start` event

### Error `400`

```json
{ "error": "Character not present at current location" }
```

---

## 7. `game-ask` — Ask a Question in Talk Mode

**Maps to**: `POST /api/game/{game_id}/ask`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `talk`

### Request Body

```json
{
  "question": "string"
}
```

### Response `200`

```json
{
  "response": "string",
  "time_remaining": "number",
  "clues_revealed": ["string (clue ID)"]
}
```

**Implementation notes**:

- Fetches last N `ask` events for this session+character as conversation history
- Builds prompt using character's `knowledge`, `stated_alibi`, `personality`, and conversation history
- AI provider (mock in this feature) returns a response within character constraints — ground truth fields (`mystery_action_real`, `is_culprit`, `motive`) are context for the AI but never leaked in response
- If AI reveals a knowledge fact, the corresponding clue ID is appended to `clues_revealed` and `game_sessions.discovered_clues`
- Deducts 1 turn; appends `ask` event

### Error `400`

```json
{ "error": "Not in talk mode" }
```

---

## 8. `game-end-talk` — End Conversation

**Maps to**: `POST /api/game/{game_id}/end_talk`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `talk`

### Request Body

_(empty)_

### Response `200`

```json
{
  "narration": "string",
  "mode": "explore"
}
```

**Implementation notes**:

- Updates `game_sessions.mode = 'explore'`, clears `current_talk_character_id`
- AI generates brief sign-off narration
- Appends `talk_end` event

---

## 9. `game-accuse` — Accuse a Suspect

**Maps to**: `POST /api/game/{game_id}/accuse`  
**Method**: `POST`  
**Auth**: None  
**Valid mode**: `explore`, `talk`, `accuse`

### Request Body

```json
{
  "accused_character_id": "string"
}
```

### Response `200`

```json
{
  "narration": "string",
  "result": "win | lose",
  "ground_truth": {
    "what_happened": "string",
    "why_it_happened": "string",
    "timeline": ["string"]
  }
}
```

**Implementation notes**:

- Validates character exists in blueprint
- Checks `is_culprit` boolean
- Updates `game_sessions.mode = 'ended'` and sets result
- AI generates showdown scene narration with character confession/denial
- Appends `accuse` event with payload `{ result, accused }`

---

## Shared Type: `GameState`

Used across `game-get` and `game-start` responses. Defined in `packages/shared/src/api-types.ts`:

```typescript
export interface GameState {
  locations: { name: string }[];
  characters: {
    first_name: string;
    last_name: string;
    location_name: string;
  }[];
  time_remaining: number;
  location: string;
  mode: "explore" | "talk" | "accuse" | "ended";
  current_talk_character: string | null;
  clues: string[]; // array of stable clue IDs
  narration: string;
  history: {
    sequence: number;
    event_type: string;
    actor: "player" | "system";
    narration: string;
  }[];
}
```
