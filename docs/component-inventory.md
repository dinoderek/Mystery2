# Component Inventory

This document serves as an inventory of reusable Svelte components in this project. **AI Agents: You must update this document whenever you create a new reusable UI component.**

## Global UI (`src/lib/ui/`)

*(Add components here as they are built. Example format below)*

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

## Layout Components

*(Add layout wrappers here)*
