# Parser Contract: Command Grammar, Validation, and Retry Touchpoints

**Feature**: 003-webui-command-parser  
**Date**: 2026-03-06

This contract defines the command parser surface used by the web store layer.

## Function Signature

```ts
parseCommand(
  rawInput: string,
  mode: 'explore' | 'talk' | 'accuse' | 'ended',
  context: ParseContext
): ParseResult
```

## ParseContext

```ts
interface ParseContext {
  locations: { name: string }[];
  characters: { first_name: string; last_name: string; location_name: string }[];
  currentLocation: string;
}
```

## Input Normalization

Applied before matching:

1. trim leading/trailing whitespace
2. lowercase
3. collapse internal whitespace to single spaces
4. remove trailing punctuation (`! ? . ,`)

## Alias Matching

### Explore Mode

Prefix matching (exact alias or alias + space + target):

- Move: `go to`, `move to`, `travel to`, `head towards`, `go`, `move`
- Talk: `talk to`, `speak to`, `speak with`
- Search: `search`, `look around`, `inspect`, `look`
- Accuse: `accuse`

Exact matching:

- Locations list: `locations`, `where can i go`
- Characters list: `characters`, `who is here`
- Help: `help`
- Quit: `quit`, `exit`

### Talk Mode

Exact matching only for control commands:

- End talk: `bye`, `leave`, `end`, `goodbye`, `see you`
- Help: `help`
- Quit: `quit`, `exit`

Any other non-empty input is `ask`.

### Accuse Mode

Exact matching only for control commands:

- Help: `help`
- Quit: `quit`, `exit`

Any other non-empty input is `ask`.

### Ended Mode

- Help: `help`
- Quit: `quit`, `exit`
- Any other input: `unrecognized`

## Target Validation

### Move

- Valid target set: `context.locations[*].name`
- Comparison: normalized, case-insensitive, with optional leading `the` tolerated
- Missing target: `missing-target` + suggestions
- Invalid target: `invalid-target` + suggestions
- Suggestions: all location names + character display names in `currentLocation`

### Talk

- Valid target set: characters in `currentLocation`
- Match by first name, last name, or full display name (normalized)
- Valid result returns `character_name` as canonical first name
- Missing/invalid target branches return current-scene character suggestions

### Accuse (explore mode)

- Valid target set: all known characters
- Match by first name, last name, or full display name (normalized)
- Valid result returns `accused_character_id` as canonical first name
- Missing/invalid target branches return all character display names

## ParseResult

```ts
type ParseResult =
  | { type: 'valid'; command: ActionCommand }
  | { type: 'missing-target'; commandType: 'move' | 'talk' | 'accuse'; suggestions: string[] }
  | {
      type: 'invalid-target';
      commandType: 'move' | 'talk' | 'accuse';
      attempted: string;
      suggestions: string[];
    }
  | { type: 'list'; listType: 'locations' | 'characters'; items: ListItem[] }
  | { type: 'unrecognized'; raw: string; hint: string }
  | { type: 'help' }
  | { type: 'quit' };
```

```ts
type ActionCommand =
  | { type: 'move'; destination: string }
  | { type: 'search' }
  | { type: 'talk'; character_name: string }
  | { type: 'ask'; question: string }
  | { type: 'accuse'; accused_character_id: string }
  | { type: 'end_talk' };
```

```ts
type ListItem =
  | { kind: 'location'; name: string; characters: string[] }
  | { kind: 'character'; displayName: string };
```

## Store Consumption Rules

- `valid` only: submit to backend endpoints
- `missing-target`, `invalid-target`, `list`, `unrecognized`, `help`, `quit`: no backend call
- `help`: open modal
- `quit`: mark session as ended client-side with inline feedback

## Retry Contract (store layer)

For `valid` commands only:

- Retry up to 3 attempts for transient failures (network/5xx/429/408)
- No retry for permanent failures (4xx)
- Emit inline retry progress messages
- On exhaustion, emit failure message and expose manual retry action
