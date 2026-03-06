# Parser Contract: Command Grammar & Validation

**Feature**: 003-webui-command-parser  
**Date**: 2026-03-06

This document defines the input grammar, alias tables, and return contract for the client-side command parser.

---

## Function Signature

```ts
parseCommand(
  rawInput: string,
  mode: 'explore' | 'talk' | 'accuse' | 'ended',
  context: ParseContext
): ParseResult
```

### ParseContext

```ts
interface ParseContext {
  locations: { name: string }[];
  characters: { first_name: string; last_name: string; location_name: string }[];
  currentLocation: string; // name of player's current location
}
```

---

## Input Normalization (applied before any matching)

1. Trim leading/trailing whitespace
2. Collapse internal whitespace runs to single space
3. Lowercase entire string
4. Strip trailing punctuation characters: `! ? . ,`

---

## Alias Tables (in priority order — longest prefix matched first)

### Mode: `explore`

| Alias prefix         | → Command     | Extracts     |
|----------------------|---------------|--------------|
| `go to <X>`          | move          | destination  |
| `move to <X>`        | move          | destination  |
| `travel to <X>`      | move          | destination  |
| `head towards <X>`   | move          | destination  |
| `go <X>`             | move          | destination  |
| `move <X>`           | move          | destination  |
| `go` *(bare)*        | move          | missing      |
| `talk to <X>`        | talk          | character    |
| `speak to <X>`       | talk          | character    |
| `speak with <X>`     | talk          | character    |
| `talk to` *(bare)*   | talk          | missing      |
| `search`             | search        | —            |
| `look around`        | search        | —            |
| `inspect`            | search        | —            |
| `look`               | search        | —            |
| `locations`          | list-locations | —            |
| `where can i go`     | list-locations | —            |
| `characters`         | list-chars    | —            |
| `who is here`        | list-chars    | —            |
| `help`               | help          | —            |
| `quit`               | quit          | —            |
| `exit`               | quit          | —            |

### Mode: `talk`

Matching in talk mode uses **exact match** on the normalized input (trimmed, lowercased, punctuation stripped). No prefix scanning.

| Exact match     | → Command   | Notes |
|-----------------|-------------|-------|
| `bye`           | end_talk    | |
| `leave`         | end_talk    | |
| `end`           | end_talk    | |
| `goodbye`       | end_talk    | |
| `see you`       | end_talk    | |
| `help`          | help        | |
| `quit`          | quit        | Terminates the game |
| `exit`          | quit        | Terminates the game |
| *(anything else)* | ask       | question = full normalized input |

### Mode: `accuse`

Accuse mode is treated like `talk` mode: **exact match only**. The player is in the final accusation sequence. The only actionable commands are those that terminate the game. Everything else is treated as an `ask` passed to the accusation conversation.

| Exact match       | → Command | Notes |
|-------------------|-----------|-------|
| `quit`            | quit      | Terminates the game |
| `exit`            | quit      | Terminates the game |
| *(anything else)* | ask       | question = full normalized input, sent to accusation context |


### Mode: `ended`

| Any input | → Command | Notes |
|-----------|-----------|-------|
| `quit`    | quit      | |
| `exit`    | quit      | |
| *(anything else)* | unrecognized | |

---

## Target Validation Rules

### Movement target (`move`)
- Match against `context.locations[*].name` (case-insensitive, normalized)
- If matched: return `ValidCommand { command: 'move', destination: location.name }`
- If no match: return `InvalidTarget { commandType: 'move', suggestions: [...] }`
- Suggestions = all location names + display names of characters currently at `currentLocation`

### Talk target
- Match against `context.characters[*].first_name` OR `context.characters[*].last_name` (case-insensitive, normalized)
- If matched: return `ValidCommand { command: 'talk', character_id: first_name + ' ' + last_name }`
- If no match: return `InvalidTarget { commandType: 'talk', suggestions: all character display names }`

> **Note**: `accuse` carries no target in the parser. The accused character was already committed when the game entered accuse mode. The parser treats all non-quit accuse-mode input as `ask`.

---

## ParseResult Contract

```ts
type ParseResult =
  | { type: 'valid'; command: ActionCommand }
  | { type: 'missing-target'; commandType: 'move' | 'talk'; suggestions: string[] }
  | { type: 'invalid-target'; commandType: 'move' | 'talk'; attempted: string; suggestions: string[] }
  | { type: 'list'; listType: 'locations' | 'characters'; items: ListItem[] }
  | { type: 'unrecognized'; raw: string; hint: string }
  | { type: 'help' }
  | { type: 'quit' }
```

### ListItem

```ts
type ListItem =
  | { kind: 'location'; name: string; characters: string[] }  // for listType='locations'
  | { kind: 'character'; displayName: string }                 // for listType='characters'
```

---

## Inline Feedback Strings

| ParseResult         | Inline message format in narration history |
|---------------------|--------------------------------------------|
| `missing-target` (move) | `"Where to? Try: [Garden, Kitchen, ...]"` |
| `missing-target` (talk) | `"Who? Try: [Rosie, Mayor Fox, ...]"` |
| `invalid-target`    | `"'X' not found. Try: [...]"` |
| `unrecognized`      | `"Commands: go, talk, search, help, quit. Type 'help' for details."` *(mode-appropriate subset)* |
| `list` (locations)  | Formatted list: one line per location, with chars listed if present |
| `list` (characters) | Formatted list: one line per character display name |
