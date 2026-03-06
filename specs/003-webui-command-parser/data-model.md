# Data Model: Web UI Command Parser

**Feature**: 003-webui-command-parser  
**Date**: 2026-03-06

---

## Core Entities

### ParseResult (replaces ActionCommand)

The return type of the `parseCommand` function. A discriminated union where every branch carries exactly the information the store needs to act.

```
ParseResult =
  | ValidCommand          # successfully parsed, target (if any) validated
  | MissingTarget         # command recognized, but no target provided
  | InvalidTarget         # command recognized, target provided but does not match known entities
  | ListRequest           # player asked to see locations or characters
  | UnrecognizedCommand   # input doesn't match any known command prefix
  | HelpRequest           # player typed "help"
```

#### ValidCommand

- `type: 'valid'`
- `command`: one of `move | talk | search | ask | end_talk | accuse | quit`
- `destination?: string` (normalized location name, for move)
- `character_id?: string` (matched character identifier, for talk/accuse)
- `question?: string` (verbatim ask, for ask in talk mode)

#### MissingTarget

- `type: 'missing-target'`
- `commandType`: `'move' | 'talk' | 'accuse'`
- `suggestions`: list of valid target names for the command type (locations + chars-at-location for move; all chars for talk/accuse)

#### InvalidTarget

- `type: 'invalid-target'`
- `commandType`: `'move' | 'talk' | 'accuse'`
- `attempted`: the raw target string the player typed
- `suggestions`: list of valid target names (same scoping as MissingTarget)

#### ListRequest

- `type: 'list'`
- `listType`: `'locations' | 'characters'`
- `locations?`: list of `{ name: string, characters: string[] }` (for listType = 'locations')
- `characters?`: string[] of character display names (for listType = 'characters')

#### UnrecognizedCommand

- `type: 'unrecognized'`
- `raw`: the original input
- `hint`: a short inline command list string appropriate to the current mode (e.g., `"go, talk, search, accuse, help, quit"`)

#### HelpRequest

- `type: 'help'`

---

### AliasMap (internal, parser.ts)

A static data structure mapping command category → ordered list of phrase prefixes. Checked from longest to shortest to ensure "speak with" is tried before "speak".

```
AliasMap = Record<CommandCategory, string[]>
```

Where `CommandCategory` is: `move | talk | search | end_talk | quit | help | locations | characters`

---

### NormalizedInput (internal)

The result of normalizing raw player input before any matching:
- Trimmed
- Lowercased
- Internal whitespace collapsed to single space
- Trailing punctuation removed (`!`, `?`, `.`, `,`)

---

## State Additions (store.svelte.ts)

The `GameSessionStore` requires new reactive state fields:

| Field | Type | Purpose |
|-------|------|---------|
| `retryCount` | `number` | Tracks current retry attempt (0–3) |
| `isRetrying` | `boolean` | Drives the retry status indicator in the UI |
| `feedbackMessage` | `string \| null` | Inline feedback message (unrecognized/target error) shown in narration |

The `status` field already drives input `disabled` state and can be reused; no new `status` variants needed.

---

## Existing Type Changes (game.ts)

`GameState` already contains the required data — **no schema changes needed**:

- `locations: { name: string }[]` → used for move target validation and list display
- `characters: { first_name, last_name, location_name }[]` → used for talk/accuse validation; filtered by `location_name` for movement suggestions
- `mode` → passed to `parseCommand` for mode-aware parsing

The only addition needed is a **derived getter** or helper to get "characters at current location" for movement target suggestions.

---

## State Transitions

```
Player types input
   ↓
normalize(input)
   ↓
parseCommand(normalized, mode, gameState) → ParseResult
   ↓
┌────────────────────────────────────────────────────────────┐
│ ValidCommand   → submit to backend → on success: update    │
│                              state; on transient error:    │
│                              retry up to 3x; on perm:      │
│                              show error message            │
│ MissingTarget  → push inline feedback + target list        │
│ InvalidTarget  → push inline feedback + target list        │
│ ListRequest    → push inline list (no backend call)        │
│ Unrecognized   → push brief command list + hint            │
│ HelpRequest    → open HelpModal (no backend call)          │
└────────────────────────────────────────────────────────────┘
```
