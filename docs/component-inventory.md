# Component Inventory

This document serves as an inventory of reusable Svelte components in this project. **AI Agents: You must update this document whenever you create a new reusable UI component.**

## Global UI (`src/lib/ui/`)

_(Add components here as they are built. Example format below)_

### `TerminalMessage.svelte`

- **Purpose**: Renders a single speaker-aware message block (label + narration body) in the terminal stream.
- **Props**:
  - `text`: `string` (message content)
  - `speaker`: `{ kind, key, label }` (canonical actor metadata from store/backend)
  - `theme`: `'matrix' | 'amber'` (active theme key used for speaker-kind classes)

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
- **Session-view behavior**:
  - Automatically disables command entry while loading.
  - Disables command entry for ended sessions.
  - Renders the read-only return prompt (`[ PRESS ANY KEY TO GO BACK TO THE MYSTERY LIST ]`) for completed-session viewer mode.

### `HelpModal.svelte`

- **Purpose**: Modal overlay displaying available commands in different modes.
- **Props**: None (reads from store)

### `TerminalSpinner.svelte`

- **Purpose**: Terminal-style ASCII spinner for loading/wait states in narration and startup flows.
- **Props**:
  - `text`: `string` (optional status text shown next to the spinner)

### `StoryImagePanel.svelte` *(deprecated — prefer `SignedImage.svelte`)*

- **Purpose**: Static image/placeholder panel. Does not manage signed URL lifecycle.
- **Note**: Replaced by `SignedImage` for all active use cases. Retained for reference.

### `SignedImage.svelte`

- **Purpose**: Self-managing signed-image component backed by `ImageLinkCache`. Handles resolution, caching, expiry, and automatic refresh of Supabase Storage signed URLs. Drop-in replacement anywhere a blueprint/location/character image is needed.
- **Props**:
  - `blueprintId`: `string` (the blueprint that owns the image)
  - `imageId`: `string` (canonical image filename from the blueprint)
  - `alt`: `string` (image alt text)
  - `class`: `string` (additional CSS classes)
  - `loadingText`: `string` (text shown while resolving, default `"Loading image..."`)
  - `placeholderText`: `string` (text shown on failure, default `"Image unavailable"`)

### `LoginForm.svelte`

- **Purpose**: Reusable email/password sign-in form for the `/login` route.
- **Props**: None (reads and updates `authStore` directly).
- **Usage**:
  - Rendered by `src/routes/login/+page.svelte`.
  - Handles required-field validation and displays authentication failures.

## Layout Components

_(Add layout wrappers here)_

## Route-Level Session Screens (Feature-Specific)

These are route components, not shared reusable UI components:

- `src/routes/sessions/in-progress/+page.svelte`
  - renders numbered in-progress session rows and handles numeric resume selection
- `src/routes/sessions/completed/+page.svelte`
  - renders numbered completed session rows and handles numeric read-only open flow
