# Data Model: Web UI

*Note: The Web UI is a stateless client. It does not own a database schema. This document describes the client-side state models used to drive the Svelte UI.*

## Client State: `GameSessionStore`

Manages the active game session state fetched from the backend.

### Properties
- `game_id`: string (UUID) | null
- `status`: `'idle' | 'loading' | 'active' | 'error'`
- `state`: `GameState` | null (The exact structure defined in the `001-supabase-api` contract)
- `error`: string | null

### Actions
- `loadBlueprints()`: Fetches the list of blueprints.
- `startGame(blueprintId)`: Initiates a new game session.
- `move(destination)`: Sends a move command.
- `search()`: Sends a search command.
- `talk(characterId)`: Initiates a conversation.
- `ask(question)`: Asks a question during talk mode.
- `endTalk()`: Ends the current conversation.
- `accuse(characterId)`: Accuses a character.

## Component State

### `NarrationBox` State
- Tracks the scroll position to ensure new fragments always auto-scroll to the bottom.
- Recognizes the "acting" state to display text-based loading indicators (e.g., ASCII spinner).

### `InputBox` State
- `currentInput`: string
- `mode`: derived from `GameSessionStore.state.mode` (`explore`, `talk`, `accuse`) to display the correct hint.
- `disabled`: boolean (true when `GameSessionStore.status === 'loading'`)
