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

- **Purpose**: Shows current location, time, hints, and visible characters, plus a
  notebook count/toggle button that opens `NotebookPanel` at the section the
  player last used (`gameSessionStore.openNotebook()`), and a `Tab: notebook`
  hint alongside the help hint.
- **Props**: None (reads from store)

### `ClueDiscoveredToast.svelte`

- **Purpose**: Transient "new clue discovered" celebration shown when a search/ask
  turn surfaces clues (`gameSessionStore.recentlyDiscovered`); tapping opens the
  notebook at its Clues section (`openNotebook('clues')`). Auto-dismisses.
- **Props**: None (reads from store)

### `PageNarration.svelte`

- **Purpose**: Renders the narration lines of the active page (`gameSessionStore.activePage`)
  and the "narrator is thinking" spinner. Follows the bottom of a live page as it
  grows; starts at the top when the player turns back to an older page.
- **Props**: None (reads from store)

### `ScenePane.svelte`

- **Purpose**: The fixed image column — two thirds of the session screen. Shows
  `activePage.imageId` via `SignedImage`, or a labelled placeholder when the page
  has no image or the image cannot be loaded.
- **Props**: None (reads from store)

### `PageNavigator.svelte`

- **Purpose**: Page controls above the narration: `‹` / `›`, a "Page N / M"
  counter, the page's `title ?? fallbackLabel`, and a `[ latest ]` jump shown
  only when the player is behind the newest page.
- **Props**: None (reads from store)

### `InputBox.svelte`

- **Purpose**: Text input for the player to enter commands, submitting to the store.
- **Props**: None (reads from store)
- **Session-view behavior**:
  - Automatically disables command entry while loading.
  - Disables command entry for ended sessions.
  - Renders the read-only return prompt (`[ TAB: REVIEW NOTEBOOK · ANY OTHER KEY: BACK TO THE MYSTERY LIST ]`) for completed-session viewer mode.
  - Renders the opening prompt (`[ PRESS ANY KEY TO BEGIN THE INVESTIGATION ]`) while
    `gameSessionStore.awaitingOpeningConfirmation` holds on the opening page.
  - Blurs itself while `showNotebook` is set (releasing its focus latch) and refocuses when the notebook closes, so notebook shortcuts never land in the command line.

### `HelpModal.svelte`

- **Purpose**: Modal overlay displaying available commands in different modes.
  The command list scrolls (`max-h-[85vh]` + `overflow-y-auto`) so the close
  button stays in view as commands are added.
- **Props**: None (reads from store)

### `NotebookPanel.svelte`

- **Purpose**: Full-screen, opaque overlay ("case notebook") showing one of four
  sections at a time behind a tab strip — Story (`premise` + `mystery_summary`),
  Places (locations with a `[ you are here ]` marker and who is at each), People
  (everyone met, with where they are), and Clues (`discovered_clues` bucketed
  into `FOUND AT PLACES` / `TOLD BY PEOPLE`, sub-grouped per location or
  character with a count, off-script grants flagged as a "lucky break").
  Grouping is deliberately player-derivable — do not group by reasoning-path
  thread, which spoils the mystery. Reads everything from
  `gameSessionStore.state`; all derivation and grouping lives in the pure
  `web/src/lib/domain/notebook.ts`.
- **Keyboard**: owns a single window `keydown` handler for every notebook key —
  `Tab` toggles (open and close), `Esc` closes, `←` / `→` change section with
  wraparound, `↑` / `↓` scroll the body, `1`-`4` jump to a section. The handler
  lives here rather than on the session page so the toggle cannot depend on
  listener registration order.
- **Accessibility**: `role="dialog"` / `aria-modal`, a `role="tablist"` strip
  with roving `tabindex`, and a `role="tabpanel"` body. Repurposing `Tab` as
  close is a deliberate deviation from the standard focus-cycle behavior: it
  means `[ CLOSE ]` is not keyboard-reachable, but `Tab` and `Esc` both close,
  so nothing is stranded. Being full-bleed, it has no backdrop to click.
- **Motion**: a ~90ms fade plus a ~140ms fly, both collapsed to zero under
  `prefersReducedMotion`. Kept short on purpose — `Tab` is a toggle players
  press repeatedly.
- **Props**: None (reads from store)
- **Used by**: `routes/session/+page.svelte`.

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
- **Note**: A signed URL can be issued for an asset that is not in storage, so the
  component also falls back to the placeholder when the `<img>` itself fails to load.

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
