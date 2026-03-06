# Component Inventory

This document serves as an inventory of reusable Svelte components in this project. **AI Agents: You must update this document whenever you create a new reusable UI component.**

## Global UI (`src/lib/ui/`)

_(Add components here as they are built. Example format below)_

### `TerminalMessage.svelte`

- **Purpose**: Renders a single block of text (chat message, narration, or system feedback) in the UI.
- **Props**:
  - `role`: `'narrator' | 'character' | 'investigator' | 'system'` (determines color/alignment)
  - `content`: `string` (the text to display)
  - `name`: `string` (optional label for the speaker)

### `TerminalInput.svelte`

- **Purpose**: The main text input area for the user to type commands.
- **Props**:
  - `disabled`: `boolean` (freezes input while waiting for backend)
  - `placeholder`: `string`

### `Header.svelte`

- **Purpose**: Displays the top-level game title and active session ID.
- **Props**: None (reads from store)

### `StatusBar.svelte`

- **Purpose**: Shows current location, time, hints, and visible characters.
- **Props**: None (reads from store)

### `NarrationBox.svelte`

- **Purpose**: Auto-scrolling container for the history of game events and latest narration.
- **Props**: None (reads from store)

### `InputBox.svelte`

- **Purpose**: Text input for the player to enter commands, submitting to the store.
- **Props**: None (reads from store)

### `HelpModal.svelte`

- **Purpose**: Modal overlay displaying available commands in different modes.
- **Props**: None (reads from store)

## Layout Components

_(Add layout wrappers here)_
