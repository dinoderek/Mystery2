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

## Mobile Components (`src/lib/components/mobile/`)

These components form the touch-optimised mobile UI layer. They are rendered
when `mobileDetect.isMobile` is true and share game/auth/theme stores with
the desktop components.

### `MobileTopBar.svelte`

- **Purpose**: Fixed-height top navigation bar used across all mobile screens. Shows back arrow, title, optional turns badge, and optional hamburger menu.
- **Props**:
  - `title`: `string` (screen title, truncated with ellipsis)
  - `turnsRemaining`: `number | undefined` (shown as `[N]` badge when provided)
  - `onback`: `() => void | undefined` (back arrow callback)
  - `onmenu`: `() => void | undefined` (hamburger menu callback)
  - `showMenu`: `boolean` (default `true`, controls hamburger visibility)

### `MobileCarousel.svelte`

- **Purpose**: Generic horizontal swipe carousel with CSS scroll-snap, peek edges, and dot indicators. Used for blueprint selection, in-progress sessions, and completed sessions.
- **Props**:
  - `items`: `T[]` (data array to render)
  - `activeIndex`: `number` (bindable, tracks the centred card)
  - `children`: `Snippet<[T, number]>` (render snippet for each card)
  - `onselect`: `(item: T, index: number) => void | undefined` (tap callback)
  - `emptyMessage`: `string` (default `"No items"`)
  - `loading`: `boolean` (shows `TerminalSpinner` when true)

### `MobileHome.svelte`

- **Purpose**: Mobile home screen with two internal views: a three-button menu (Start New Case, Resume Case, Case History) and a blueprint carousel sub-view for starting new games.
- **Props**: None (reads from `gameSessionStore`, `authStore`).

### `MobileSession.svelte`

- **Purpose**: Main mobile session orchestrator composing all sub-components into reading/input mode gameplay. Manages session mode, drawer, image viewer, input draft, and end-state display.
- **Props**: None (reads from `gameSessionStore`, `mobilePrefs`).

### `MobileInputBar.svelte`

- **Purpose**: Text input bar for the session input mode with cancel and send buttons. Auto-focuses on mount, supports prefilled text from quick actions.
- **Props**:
  - `onsend`: `(text: string) => void` (send callback)
  - `oncancel`: `() => void` (cancel callback)
  - `disabled`: `boolean` (freezes input while loading)
  - `placeholder`: `string` (mode-aware placeholder)
  - `prefill`: `string | undefined` (initial input value)

### `MobileActionBar.svelte`

- **Purpose**: Quick-action button bar at the bottom of reading mode. Shows mode-appropriate buttons (Move, Talk, Search, Accuse, Reply in explore; End convo, Reply in talk; State your reasoning in accuse).
- **Props**:
  - `onreply`: `() => void` (opens input mode)
  - `oninputprefill`: `(text: string) => void` (opens input mode with prefilled text)

### `MobileListPicker.svelte`

- **Purpose**: Bottom-sheet overlay for selecting from a list (locations, characters). Slides up with backdrop, tappable rows, and cancel button.
- **Props**:
  - `title`: `string` (picker header)
  - `items`: `{ id: string, label: string, subtitle?: string }[]` (selectable rows)
  - `onselect`: `(item) => void` (selection callback)
  - `oncancel`: `() => void` (dismiss callback)

### `MobileDrawer.svelte`

- **Purpose**: Slide-down drawer from below the top bar with status info, actions (Help, Zoom), appearance settings (theme picker, text size), and quit button.
- **Props**:
  - `open`: `boolean` (bindable, controls visibility)

### `MobileImageViewer.svelte`

- **Purpose**: Fullscreen image viewer overlay. Shows a `SignedImage` centred on screen with close button. Closes on backdrop tap or Escape key.
- **Props**:
  - `blueprintId`: `string` (image owner)
  - `imageId`: `string` (image filename)
  - `alt`: `string` (alt text, default `""`)
  - `onclose`: `() => void` (close callback)

## Layout Components

_(Add layout wrappers here)_

## Route-Level Session Screens (Feature-Specific)

These are route components, not shared reusable UI components:

- `src/routes/sessions/in-progress/+page.svelte`
  - renders numbered in-progress session rows and handles numeric resume selection
- `src/routes/sessions/completed/+page.svelte`
  - renders numbered completed session rows and handles numeric read-only open flow
