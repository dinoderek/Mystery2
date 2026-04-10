# Mobile UI Plan

## Context

The app is a terminal-styled text adventure (mystery game for kids 6-11) built
with SvelteKit 5 + Tailwind CSS v4, deployed as a static site. The current UI is
keyboard-first with minimal mobile adaptation (hidden iOS keyboard proxy, basic
responsive image floats, a mobile back button). Playing on a phone is functional
but clunky: numeric menus don't suit touch, the status bar and input compete for
screen space, and the brief creator is unusable on small screens.

This plan introduces a dedicated mobile UI layer that preserves the terminal
aesthetic while embracing touch-native interaction patterns. Desktop remains
completely untouched.

---

## Principles

- **Desktop is untouched.** All mobile work is additive. Route pages branch on
  `isMobile` and render separate component trees.
- **Shared logic stays shared.** Game store, auth store, theme store, API calls,
  command parsing — all reused. Only layout and interaction patterns change.
- **No new dependencies.** Swipe uses native CSS scroll-snap. Transitions use
  Svelte builtins. No gesture libraries.
- **Theme tokens only.** All styling uses `t-*` tokens per existing conventions.
- **Terminal aesthetic preserved.** Monospace, dark bg, glowing text, borders.

---

## User Journeys

### Out-of-narration journeys

#### J1. Select a blueprint (start new game)

**Entry:** User opens the app on mobile and lands on `/`.

**Flow:**

```
  ┌────────────────────────────┐
  │                            │
  │    MYSTERY TERMINAL        │
  │                            │
  │  ┌──────────────────────┐  │
  │  │   Start New Case     │  │
  │  └──────────────────────┘  │
  │                            │
  │  ┌──────────────────────┐  │
  │  │   Resume Case  (3)   │  │
  │  └──────────────────────┘  │
  │                            │
  │  ┌──────────────────────┐  │
  │  │   Case History (1)   │  │
  │  └──────────────────────┘  │
  │                            │
  │                   [LOGOUT] │
  └────────────────────────────┘
```

1. User sees three large, tappable buttons: "Start New Case", "Resume Case (N)",
   "Case History (N)". No keyboard involved.
2. User taps **"Start New Case"**.
3. The view transitions (within the same page, no route change) to the blueprint
   carousel. A top bar appears with a back arrow and title "Choose a Mystery".

```
  ┌──────────────────────────────────┐
  │  ←   Choose a Mystery            │
  ├──────────────────────────────────┤
  │                                  │
  │  ╭╌╌╌╌╮ ┌──────────────┐ ╭╌╌╌╌╮ │
  │  ╎    ╎ │              │ ╎    ╎ │
  │  ╎prev╎ │  [cover img] │ ╎next╎ │
  │  ╎card╎ │              │ ╎card╎ │
  │  ╎    ╎ │  The Missing  │ ╎    ╎ │
  │  ╭╌╌╌╌╮ │  Amulet       │ ╭╌╌╌╌╮ │
  │         │  Ages 8-10    │         │
  │         │               │         │
  │         └──────────────┘         │
  │           ○  ●  ○  ○             │
  │                                  │
  │       [ TAP CARD TO START ]      │
  └──────────────────────────────────┘
```

4. User **swipes left/right** to browse blueprints. CSS scroll-snap handles the
   physics. Peek edges (the faded previous/next cards visible at ~10% width on
   each side) signal that more cards exist.
5. **Dot indicators** below the carousel track position (e.g. 2 of 4).
6. User **taps a card** to select a blueprint.
7. A loading spinner appears ("Starting mystery..."). The store calls
   `gameSessionStore.startGame(blueprintId)`.
8. On success, `goto('/session')` takes the user to the narration screen.
9. **Back arrow** in the top bar returns to the three-button menu.

**Loading / error states:**
- If blueprints haven't loaded yet, the carousel area shows `TerminalSpinner`
  with "Loading mysteries...".
- If loading fails, an error message replaces the carousel with a retry prompt.

---

#### J2. Resume a game

**Entry:** User taps **"Resume Case (N)"** on the home screen.

**Flow:**

1. User is navigated to `/sessions/in-progress`.
2. The mobile layout shows a top bar ("Resume Case", back arrow, no hamburger)
   and the session carousel below.

```
  ┌──────────────────────────────────┐
  │  ←   Resume Case                 │
  ├──────────────────────────────────┤
  │                                  │
  │  ╭╌╌╌╌╮ ┌──────────────┐ ╭╌╌╌╌╮ │
  │  ╎    ╎ │              │ ╎    ╎ │
  │  ╎    ╎ │  The Missing  │ ╎    ╎ │
  │  ╎    ╎ │  Amulet       │ ╎    ╎ │
  │  ╭╌╌╌╌╮ │              │ ╭╌╌╌╌╮ │
  │         │  Turns left: 5 │        │
  │         │  2 hours ago   │        │
  │         │               │         │
  │         └──────────────┘         │
  │              ●  ○  ○             │
  │                                  │
  │       [ TAP CARD TO RESUME ]     │
  └──────────────────────────────────┘
```

3. Each card shows: mystery title (bold), turns remaining, last played time.
4. **Unavailable sessions** (where `can_open === false`) show a dimmed card with
   a warning badge: "Mystery file unavailable". Tapping shows a toast/message
   rather than navigating.
5. User **swipes** to browse, **taps** to select.
6. On tap, store calls `gameSessionStore.resumeSession(session.game_id)`.
   Loading spinner. On success, `goto('/session')`.
7. **Back arrow** returns to `/` (home).

**Edge cases:**
- If the session list is empty (user navigated here directly), show a centred
  message: "No cases in progress" with a "Start New Case" link.
- The "Resume Case" button on home is disabled (dimmed, non-tappable) when count
  is 0, so this is a safety-net only.

---

#### J3. View history

**Entry:** User taps **"Case History (N)"** on the home screen.

**Flow:**

1. User is navigated to `/sessions/completed`.
2. Identical layout to J2, but card content differs:

```
  ┌──────────────────────────────────┐
  │  ←   Case History                │
  ├──────────────────────────────────┤
  │                                  │
  │         ┌──────────────┐         │
  │         │              │         │
  │         │  The Missing  │         │
  │         │  Amulet       │         │
  │         │              │         │
  │         │  ✓ Solved     │         │
  │         │  Yesterday    │         │
  │         │               │         │
  │         └──────────────┘         │
  │              ●  ○                │
  │                                  │
  │        [ TAP CARD TO VIEW ]      │
  └──────────────────────────────────┘
```

3. Each card shows: mystery title, outcome (Solved / Unsolved), last played.
4. User taps a card → store calls `gameSessionStore.resumeSession(id)` (in
   read-only mode, `viewerMode = 'read_only_completed'`).
5. The session screen opens in **reading mode** (see J4) but with no reply
   button and no input. The player scrolls through their past narration. Tap
   back arrow to return.

---

### In-narration journeys

#### J4. Read narration (reading mode)

**Entry:** User arrives at `/session` after starting or resuming a game.

**Default state — full-screen narration:**

```
  ┌──────────────────────────────────┐
  │  ←   The Missing Amulet      ≡  │  ← MobileTopBar
  ├──────────────────────────────────┤
  │                                  │
  │  NARRATOR                        │
  │  You enter the dusty library.    │
  │  Books line the walls from       │
  │  floor to ceiling...             │
  │                                  │
  │  ┌────────────────────────────┐  │
  │  │      [scene image]        │  │
  │  └────────────────────────────┘  │
  │                                  │
  │  INVESTIGATOR                    │
  │  > search the desk               │
  │                                  │
  │  NARRATOR                        │
  │  Under a stack of papers you     │
  │  find a torn photograph...       │
  │                                  │
  │                                  │
  │  ┌────┐ ┌────┐ ┌────┐    [💬]   │  ← quick actions + reply
  │  │Move│ │Talk│ │ 🔍 │           │
  │  └────┘ └────┘ └────┘           │
  └──────────────────────────────────┘
```

- The **NarrationBox** component fills the viewport between the top bar and the
  bottom action area. It is reused unchanged — it adapts to its flex parent. The
  user scrolls vertically to read history.
- Images display inline within the narration at full width (the existing
  `narration-image-float` class already renders full-width on mobile).
- The narration auto-scrolls to the latest entry when new content arrives.
- When the store is in `loading` state, a `TerminalSpinner` appears at the
  bottom of the narration area.
- **Read-only mode** (viewing completed games): same layout but no quick-action
  buttons and no reply button.

---

#### J5. Write / submit input (input mode)

**Entry:** User taps the **reply button** [💬] or a quick-action button that
requires free text (e.g. "Search" opens input with pre-filled "search ", or
"Accuse" opens input with pre-filled "accuse ").

**Split-screen layout:**

```
  ┌──────────────────────────────────┐
  │  ←   The Missing Amulet      ≡  │
  ├──────────────────────────────────┤
  │                                  │
  │  NARRATOR                        │
  │  Under a stack of papers you     │
  │  find a torn photograph...       │
  │                                  │
  ├──────────────────────────────────┤
  │ > explore mode...          [ ➤ ] │  ← MobileInputBar
  ├──────────────────────────────────┤
  │          [ keyboard ]            │
  └──────────────────────────────────┘
```

1. The top section shows the **last interaction group** — the most recent 1-3
   history entries that share the latest sequence number. This gives the player
   context for what they're responding to without showing the full history.
   Rendered with `TerminalMessage` components (reused unchanged).
2. The **MobileInputBar** appears at the bottom with a real visible `<input>`
   element (not the hidden proxy). The keyboard rises automatically because the
   input receives focus.
3. The input placeholder reflects the current mode: "> explore mode...",
   "> talk mode...", "> accuse mode...".
4. User types their command and taps the **send button** [➤] or presses Enter.
5. The input clears, `gameSessionStore.submitInput(text)` is called, and the
   view **auto-returns to reading mode**. The new narration appears and
   auto-scrolls to the bottom.
6. If the store enters `loading` state, the input is disabled and the send
   button shows a spinner.
7. **Cancelling:** User can tap the **back arrow** in the top bar or swipe the
   keyboard down to dismiss and return to reading mode without submitting.

**Pre-filled input from quick actions:**
- When a quick-action button triggers input mode (e.g. "Search"), the input bar
  appears with pre-filled text like "search " so the user can optionally add a
  search term or just hit send.

---

#### J6. Quick actions (touch affordances)

**Problem:** On desktop, the player types commands like "go to library",
"talk to Mrs. Smith", "search", "bye". On mobile, requiring all interactions to
go through text input is cumbersome — especially for kids aged 6-11.

**Solution:** A **quick-action bar** at the bottom of reading mode that provides
tap-based shortcuts for the most common commands. The actions change based on the
current game mode.

**Explore mode quick actions:**

```
  ┌────┐ ┌────────┐ ┌────┐ ┌───────┐    [💬]
  │Move│ │  Talk  │ │ 🔍 │ │Accuse │
  └────┘ └────────┘ └────┘ └───────┘
```

- **Move** — Opens a list overlay showing all locations from
  `gameSessionStore.state.locations`. User taps a location. Equivalent to
  typing `go to [location]`. Calls
  `gameSessionStore.submitInput('go to ' + locationName)`.
- **Talk** — Opens a list overlay showing characters at the current location
  (derived from `state.characters` filtered by `state.location`, same logic as
  `StatusBar`). User taps a character name. Equivalent to typing
  `talk to [name]`. If no characters are present, the button is dimmed.
- **Search** [🔍] — Directly submits `search` command. No overlay needed — it's
  a single action. Equivalent to typing "search".
- **Accuse** — Switches to input mode with "accuse " pre-filled, so the user
  can type their reasoning.
- **Reply** [💬] — Opens input mode with an empty input for free-form commands.

**Talk mode quick actions:**

```
  ┌──────────┐                       [💬]
  │End convo │
  └──────────┘
```

- **End convo** — Directly submits `bye`. Returns to explore mode. Equivalent to
  typing "bye".
- **Reply** [💬] — Opens input mode so the user can type a question to the
  character.

**Accuse mode quick actions:**

```
                                     [💬]
```

- Only the reply button. The user must type their accusation reasoning. The
  quick action bar may show a label: "State your accusation reasoning".

**Implementation notes:**
- The action bar is a horizontal row of pill-shaped buttons, scrollable if they
  overflow (though they shouldn't — max 5 items).
- Fixed to the bottom of the reading mode view, above the safe area inset.
- The Move and Talk overlays are simple bottom-sheet lists that slide up with
  `transition:slide`. Each item is a tappable row. Tapping an item closes the
  overlay and submits the command.
- All actions go through `gameSessionStore.submitInput()` with the appropriate
  command string — this means the command parser, backend invocation, retry
  logic, and narration rendering all work identically to the desktop text input.
- While `gameSessionStore.status === 'loading'`, all quick-action buttons are
  disabled.

**Move overlay example:**

```
  ┌──────────────────────────────────┐
  │  ←   The Missing Amulet      ≡  │
  ├──────────────────────────────────┤
  │                                  │
  │  (narration, dimmed)             │
  │                                  │
  ├──────────────────────────────────┤
  │  WHERE DO YOU WANT TO GO?        │
  │                                  │
  │  ┌────────────────────────────┐  │
  │  │  The Library           →  │  │
  │  ├────────────────────────────┤  │
  │  │  The Garden            →  │  │
  │  ├────────────────────────────┤  │
  │  │  The Kitchen           →  │  │
  │  ├────────────────────────────┤  │
  │  │  The Study             →  │  │
  │  └────────────────────────────┘  │
  │                                  │
  │         [ CANCEL ]               │
  └──────────────────────────────────┘
```

**Talk overlay:** Same structure, titled "WHO DO YOU WANT TO TALK TO?", listing
characters at the current location with their full names. Characters not at the
current location are not shown.

---

#### J7. View scene image

**Current desktop:** User types `zoom` to open `SceneZoomModal` which shows the
image fullscreen alongside narration text.

**Mobile approach:** Simplify. On mobile, tapping an image in the narration
opens it **fullscreen** — just the image, no side-panel text. Tap anywhere or
tap a close button to dismiss.

```
  ┌──────────────────────────────────┐
  │                            [ ✕ ] │
  │                                  │
  │                                  │
  │         [scene image             │
  │          displayed               │
  │          fullscreen,             │
  │          centered,               │
  │          object-contain]         │
  │                                  │
  │                                  │
  │                                  │
  └──────────────────────────────────┘
```

- The existing `SceneZoomModal` is desktop-oriented (side-by-side text + image).
  On mobile, we render a simpler **`MobileImageViewer`** overlay instead.
- Triggered by tapping any `SignedImage` in the narration. The `NarrationBox`
  wraps images in a tappable container that, on mobile, opens the viewer.
- The `zoom` command from the drawer also opens this viewer for the most recent
  image.
- The viewer is a fixed overlay (`inset-0 z-50 bg-t-bg`) with the image
  centred (`object-contain max-h-full max-w-full`).
- Close via: tap backdrop, tap ✕ button, or swipe down (optional stretch goal).

**Note:** The desktop `zoom` command and `SceneZoomModal` remain unchanged.

---

#### J8. Open help

**Current desktop:** User types `help` → `HelpModal` opens as an overlay.

**Mobile flow:**

1. User taps the **hamburger** (≡) in the top bar.
2. The **drawer** slides down.
3. User taps **"Help"** in the drawer's action section.
4. `gameSessionStore.showHelp = true` is set, which triggers the existing
   `HelpModal` to render. The modal is already a full-screen overlay with
   `max-w-lg w-full` and works on mobile.
5. User reads the command reference and taps "CLOSE" to dismiss.
6. The drawer auto-closes when Help is opened.

The `HelpModal` component is reused unchanged.

---

#### J9. See status information

**Current desktop:** Always visible in `StatusBar` below the narration.

**Mobile flow:**

1. User taps the **hamburger** (≡) in the top bar.
2. The **drawer** slides down, showing status at the top:

```
  ┌──────────────────────────────────┐
  │  ←   The Missing Amulet      ✕  │
  ├──────────────────────────────────┤
  │                                  │
  │  LOCATION: The Library           │
  │  TIME: 8 turns remaining         │
  │  CHARACTERS: Mrs. Smith,         │
  │              Professor Oak       │
  │                                  │
  │  ──────────────────────────────  │
  │                                  │
  │  ┌──────┐ ┌──────┐ ┌──────┐     │
  │  │ Help │ │ Zoom │ │ Aᴬ   │     │
  │  └──────┘ └──────┘ └──────┘     │
  │                                  │
  │  ──────────────────────────────  │
  │                                  │
  │  THEME:                          │
  │  ○ Classic  ● Amber  ○ Ice      │
  │  ○ Phosphor  ○ Noir             │
  │                                  │
  │  ──────────────────────────────  │
  │                                  │
  │  ┌──────────────────────────┐    │
  │  │       End Session        │    │
  │  └──────────────────────────┘    │
  │                                  │
  └──────────────────────────────────┘
```

3. The status section uses the same derived data as `StatusBar.svelte`:
   - Location name: resolved from `state.locations` by matching `state.location`
   - Time: `state.time_remaining`
   - Characters: `state.characters` filtered by current location
4. The drawer closes when: user taps ✕, taps the backdrop, or selects an action.

**Data source:** Same derivations as `StatusBar.svelte` — imported from
`gameSessionStore.state`.

---

#### J10. Exit narration

**Ways to leave the session screen:**

1. **Back arrow** in the top bar → navigates to `/` (home). If the game is in
   progress, the session is implicitly preserved (the store already persists
   state server-side on each move).
2. **"End Session"** button in the drawer → calls
   `gameSessionStore.submitInput('quit')` which triggers the quit flow. The game
   ends and the player sees the end-state screen.
3. **End-state screen** (after case solved/unsolved) → full-screen outcome
   display. Tap anywhere to return home.

**End-state display:**

```
  ┌──────────────────────────────────┐
  │                                  │
  │                                  │
  │                                  │
  │       ┌──────────────────┐       │
  │       │                  │       │
  │       │   CASE SOLVED    │       │
  │       │                  │       │
  │       │   Justice is     │       │
  │       │   served.        │       │
  │       │                  │       │
  │       └──────────────────┘       │
  │                                  │
  │     [ TAP ANYWHERE TO RETURN ]   │
  │                                  │
  │                                  │
  └──────────────────────────────────┘
```

- Replaces the normal session view entirely.
- Uses `accusationOutcome` from the store ('win' → CASE SOLVED, 'lose' → CASE
  UNSOLVED).
- Tap anywhere calls `goto('/')`.

---

#### J11. Change text size

**New feature for mobile.** A zoom button (Aᴬ) in the drawer that cycles
through text sizes.

**Sizes:** Small (14px) → Medium (16px, default) → Large (18px)

**Flow:**

1. User opens the drawer via hamburger.
2. User taps the **Aᴬ** button in the actions row.
3. Text size cycles to the next value. The label on the button updates to show
   the current size (e.g. "Aᴬ M" → "Aᴬ L" → "Aᴬ S").
4. The change applies immediately to the narration text. The user can see the
   effect before closing the drawer (since the narration is behind the
   semi-transparent backdrop).
5. The preference is persisted in `localStorage` (key:
   `mystery-game-text-size`).

**Implementation:**
- A new `textSize` property in a small store (could be added to
  `mobile-detect.svelte.ts` or a new `mobile-prefs.svelte.ts`).
- Applied as a CSS class on the narration container: `text-sm` (14px),
  `text-base` (16px), or `text-lg` (18px).
- Only affects the narration area and terminal messages, not the top bar, drawer,
  or input bar.
- Desktop is unaffected (the feature only renders in the mobile drawer).

---

### Journey summary

| # | Journey | Trigger | Key interaction |
|---|---------|---------|-----------------|
| J1 | Select blueprint | Tap "Start New Case" | Swipe carousel, tap card |
| J2 | Resume game | Tap "Resume Case" | Swipe carousel, tap card |
| J3 | View history | Tap "Case History" | Swipe carousel, tap card (read-only) |
| J4 | Read narration | Enter session | Scroll vertically, full-screen narration |
| J5 | Write input | Tap 💬 or quick action | Split screen, keyboard, send button |
| J6 | Quick actions | Tap action buttons | Move/Talk overlays, Search/Bye direct |
| J7 | View image | Tap image in narration | Fullscreen overlay, tap to close |
| J8 | Open help | Hamburger → Help | Existing HelpModal overlay |
| J9 | See status | Hamburger → drawer | Location, time, characters |
| J10 | Exit narration | Back arrow or quit | Navigate home |
| J11 | Text size | Hamburger → Aᴬ | Cycle small/medium/large |

---

## Phase 1 — Infrastructure

No visible changes. Sets up the foundation.

### 1.1 Mobile detection store

**New file:** `web/src/lib/domain/mobile-detect.svelte.ts`

Centralises the `matchMedia('(hover: none) and (pointer: coarse)')` check that
is currently duplicated in `MobileBackButton` and `MobileKeyboardProxy`.

```
class MobileDetectStore {
  isMobile = $state(false);
  private mql: MediaQueryList | null = null;

  init() {
    if (typeof window === 'undefined') return;
    this.mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    this.isMobile = this.mql.matches;
    this.mql.addEventListener('change', (e) => { this.isMobile = e.matches; });
  }
}
export const mobileDetect = new MobileDetectStore();
```

- Reactive via `$state` — components that read `mobileDetect.isMobile` re-render
  when the value changes (e.g. Chrome DevTools toggle).
- SSR-safe: defaults to `false` until `init()` runs in the browser.
- Follows the exact same pattern as `MobileKeyboardStore` and `ThemeStore`.

### 1.2 Layout integration

In `web/src/routes/+layout.svelte`, add `mobileDetect.init()` alongside the
existing `themeStore.init()` call inside `onMount`.

### 1.3 Refactor existing mobile components

`MobileBackButton` and `MobileKeyboardProxy` import from `mobileDetect` instead
of running their own `matchMedia`. Optional cleanup, can defer.

### 1.4 Directory structure

Create `web/src/lib/components/mobile/` for all new mobile components.

### 1.5 Unit tests

**New file:** `web/src/lib/domain/mobile-detect.test.ts`

- `isMobile` defaults to `false`
- `init()` reads from mocked `matchMedia`
- `change` event listener updates `isMobile`

---

## Phase 2 — Home Screen

### 2.1 Mobile home component

**New file:** `web/src/lib/components/mobile/MobileHome.svelte`

Implements journeys J1, J2, J3.

- Three vertically stacked tappable buttons (see J1 wireframe).
- **Reads from:** `gameSessionStore` (catalog counts, blueprints), `authStore`
  (signOut).
- Resume and History buttons disabled (dimmed) when counts are 0.
- Counts shown as badges.
- "Start New Case" transitions to an inline blueprint carousel sub-view (no
  route change).
- No "Manage Briefs" button.
- No `mobileKeyboard.inputMode` set (tap-based, no proxy keyboard needed).
- Loads session catalog on mount via `gameSessionStore.loadSessionCatalog(true)`.
- Minimum touch target: 48px height.

### 2.2 Route integration

In `web/src/routes/+page.svelte`:

```svelte
{#if mobileDetect.isMobile}
  <MobileHome />
{:else}
  <!-- existing desktop markup, completely unchanged -->
{/if}
```

### 2.3 Gate briefs on mobile

In `web/src/routes/briefs/+page.svelte`, `briefs/new/+page.svelte`, and
`briefs/[id]/+page.svelte`, add a redirect guard:

```js
onMount(() => {
  if (mobileDetect.isMobile) { goto('/'); return; }
  // ... existing logic
});
```

---

## Phase 3 — Carousel

### 3.1 Generic carousel component

**New file:** `web/src/lib/components/mobile/MobileCarousel.svelte`

Implements the selection interaction for J1, J2, J3.

**Props:**
- `items: T[]` — generic array
- `activeIndex: number` — bindable, two-way
- `children: Snippet<[T, number]>` — Svelte 5 snippet for card rendering
- `onselect?: (item: T, index: number) => void` — tap callback
- `emptyMessage?: string` — empty state text
- `loading?: boolean` — shows `TerminalSpinner`

**Implementation — CSS scroll-snap, no JS gestures:**
- Container: `overflow-x: auto; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;`
- Cards: `scroll-snap-align: center; flex-shrink: 0; width: 80vw;
  max-width: 320px;`
- Peek effect via horizontal padding on container: `px-[10vw]`
- `scrollend` event updates `activeIndex` (with `scroll` + debounce fallback
  for older Safari)
- Dot indicators below: active = `bg-t-primary`, inactive = `bg-t-muted/30`.
  Tap a dot to scroll to that card.
- Hide scrollbar via custom CSS utility `.scrollbar-none` added to `layout.css`.

### 3.2 Scrollbar-none CSS

Add to `web/src/routes/layout.css`:

```css
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
```

### 3.3 Blueprint carousel integration

Inside `MobileHome`, when user taps "Start New Case":
- Local view state switches to `'new-game'`
- Renders `MobileTopBar` (back arrow → return to buttons) + `MobileCarousel`
  with `gameSessionStore.blueprints`
- Card snippet: `SignedImage` (cover), title, one-liner, target age
- Tap card → `gameSessionStore.startGame(blueprint.id)` → `goto('/session')`

### 3.4 Session list carousel integration

In `web/src/routes/sessions/in-progress/+page.svelte` and
`sessions/completed/+page.svelte`:

```svelte
{#if mobileDetect.isMobile}
  <MobileTopBar title="Resume Case" onback={() => goto('/')} showMenu={false} />
  <MobileCarousel items={sessions} onselect={handleSelect}>
    {#snippet children(session, i)}
      <!-- card content: title, turns/outcome, last played -->
    {/snippet}
  </MobileCarousel>
{:else}
  <!-- existing desktop markup -->
{/if}
```

---

## Phase 4 — Session Screen

Implements journeys J4 through J11.

### 4.1 Mobile top bar

**New file:** `web/src/lib/components/mobile/MobileTopBar.svelte`

**Props:**
- `title: string`
- `onback?: () => void`
- `onmenu?: () => void`
- `showMenu?: boolean` (default true)

Fixed-height bar. Back arrow left, truncated title center, hamburger right. All
touch targets minimum 44x44px. Uses safe area inset padding at top.

### 4.2 Mobile drawer

**New file:** `web/src/lib/components/mobile/MobileDrawer.svelte`

Implements J8 (help), J9 (status), J11 (text size), and part of J10 (quit).

**Props:**
- `open: boolean` (bindable)

**Sections:**
1. **Status** — Location, time, characters (same derivations as `StatusBar`).
2. **Actions** — Tap buttons: Help, Zoom (if image available), Aᴬ (text size).
3. **Theme** — 5 themes from `themeStore.getThemeList()`, tap to switch.
4. **Quit** — "End Session" button.

Uses `transition:slide` for animation. Backdrop overlay closes on tap.

**Reads from:** `gameSessionStore.state`, `themeStore`

### 4.3 Mobile input bar

**New file:** `web/src/lib/components/mobile/MobileInputBar.svelte`

Implements J5 (write input).

**Props:**
- `onsend: (text: string) => void`
- `disabled: boolean`
- `placeholder: string`
- `prefill?: string` — optional pre-filled text from quick actions

- Input `font-size: 16px` (prevents iOS auto-zoom).
- Submit on Enter or send button tap.
- Clears after submission.
- Uses safe area inset padding at bottom.

### 4.4 Quick-action bar

**New file:** `web/src/lib/components/mobile/MobileActionBar.svelte`

Implements J6 (touch affordances).

**Props:**
- `onreply: () => void` — opens input mode
- `oninputprefill: (text: string) => void` — opens input mode with pre-filled
  text

**Behaviour:**
- Reads `gameSessionStore.state.mode` to determine which buttons to show.
- **Explore mode:** Move, Talk, Search, Accuse, Reply (💬)
- **Talk mode:** End convo, Reply (💬)
- **Accuse mode:** Reply (💬) only
- Move button → opens `MobileLocationPicker` overlay
- Talk button → opens `MobileCharacterPicker` overlay
- Search → directly calls `gameSessionStore.submitInput('search')`
- End convo → directly calls `gameSessionStore.submitInput('bye')`
- Accuse → calls `oninputprefill('accuse ')`
- Disabled state when `gameSessionStore.status === 'loading'`

**Reads from:** `gameSessionStore.state`

### 4.5 Location and character pickers

**New file:** `web/src/lib/components/mobile/MobileListPicker.svelte`

A reusable bottom-sheet overlay for selecting from a list of items.

**Props:**
- `title: string` — e.g. "Where do you want to go?"
- `items: { id: string, label: string }[]`
- `onselect: (item) => void`
- `oncancel: () => void`

Used for both location picking (J6: Move) and character picking (J6: Talk).
- **Locations source:** `gameSessionStore.state.locations` mapped to
  `{ id: loc.id, label: loc.name }`
- **Characters source:** `gameSessionStore.state.characters` filtered by current
  location, mapped to `{ id: char.id, label: char.first_name + ' ' + char.last_name }`

Slides up with `transition:slide`. Each row is a tappable item. Tapping submits
the command (e.g. `go to The Library` or `talk to Mrs. Smith`) and closes.

### 4.6 Mobile image viewer

**New file:** `web/src/lib/components/mobile/MobileImageViewer.svelte`

Implements J7 (view scene image).

**Props:**
- `blueprintId: string`
- `imageId: string`
- `alt?: string`
- `onclose: () => void`

Fullscreen overlay with centred image. Tap backdrop or ✕ to close. Uses
`SignedImage` internally.

### 4.7 Mobile session component

**New file:** `web/src/lib/components/mobile/MobileSession.svelte`

Orchestrates J4-J11. Composes all the above components.

**Internal state:**
- `sessionMode: 'reading' | 'input'`
- `drawerOpen: boolean`
- `showLocationPicker: boolean`
- `showCharacterPicker: boolean`
- `showImageViewer: boolean`
- `activeViewerImageId: string | null`
- `inputPrefill: string`

**Reading mode:** MobileTopBar + NarrationBox + MobileActionBar (+ floating
reply button).

**Input mode:** MobileTopBar + last interaction group + MobileInputBar.

**Overlays (rendered at all times, visibility controlled by state):**
- MobileDrawer
- MobileListPicker (locations)
- MobileListPicker (characters)
- MobileImageViewer
- HelpModal (existing, triggered via `gameSessionStore.showHelp`)

### 4.8 Text size store

**New file or extend:** `web/src/lib/domain/mobile-prefs.svelte.ts`

```
type TextSize = 'sm' | 'base' | 'lg';

class MobilePrefsStore {
  textSize = $state<TextSize>('base');

  init() {
    const saved = localStorage.getItem('mystery-game-text-size');
    if (saved === 'sm' || saved === 'base' || saved === 'lg') {
      this.textSize = saved;
    }
  }

  cycleTextSize() {
    const order: TextSize[] = ['sm', 'base', 'lg'];
    const next = order[(order.indexOf(this.textSize) + 1) % order.length];
    this.textSize = next;
    localStorage.setItem('mystery-game-text-size', next);
  }
}
export const mobilePrefs = new MobilePrefsStore();
```

Applied as a CSS class on the narration container in `MobileSession`:
`text-sm` / `text-base` / `text-lg`.

### 4.9 Route integration

In `web/src/routes/session/+page.svelte`:

```svelte
{#if mobileDetect.isMobile}
  <MobileSession />
{:else}
  <!-- existing desktop: Header, NarrationBox, StatusBar, InputBox, modals -->
{/if}
```

---

## Phase 5 — Polish

### 5.1 Safe area insets

Update `web/src/app.html` viewport meta:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Apply `env(safe-area-inset-*)` padding to `MobileTopBar` (top) and
`MobileInputBar` / `MobileActionBar` (bottom).

### 5.2 Theme verification

Verify all 5 themes (classic, amber, ice, phosphor, noir) render correctly
across all new mobile components.

### 5.3 Cross-browser testing

Test on iOS Safari (iPhone SE, iPhone 14) and Android Chrome (Pixel 5).

### 5.4 Documentation updates

Update `docs/component-inventory.md` with new mobile components.
Update `docs/screen-navigation.md` with mobile flows and journey references.

---

## New Components Summary

| File | Purpose | Journeys |
|------|---------|----------|
| `mobile/MobileHome.svelte` | Three-button home + blueprint carousel | J1, J2, J3 |
| `mobile/MobileCarousel.svelte` | Generic horizontal swipe carousel | J1, J2, J3 |
| `mobile/MobileSession.svelte` | Reading/input mode orchestrator | J4-J11 |
| `mobile/MobileTopBar.svelte` | Minimal top nav bar | J4, J8, J9, J10 |
| `mobile/MobileDrawer.svelte` | Slide-down menu panel | J8, J9, J10, J11 |
| `mobile/MobileInputBar.svelte` | Visible text input + send button | J5 |
| `mobile/MobileActionBar.svelte` | Mode-aware quick-action buttons | J6 |
| `mobile/MobileListPicker.svelte` | Bottom-sheet list selector | J6 |
| `mobile/MobileImageViewer.svelte` | Fullscreen image overlay | J7 |
| `domain/mobile-detect.svelte.ts` | Shared reactive `isMobile` flag | All |
| `domain/mobile-prefs.svelte.ts` | Text size preference | J11 |

## Existing Components Reused Unchanged

- `NarrationBox` — full reading mode in `MobileSession`
- `TerminalMessage` — narration entries in input mode context display
- `TerminalSpinner` — loading states everywhere
- `SignedImage` — cover images in carousel, scene images in viewer
- `HelpModal` — full-screen overlay, works on any size

## Existing Components Not Used on Mobile

- `Header` — replaced by `MobileTopBar`
- `StatusBar` — content moved into `MobileDrawer`
- `InputBox` — replaced by `MobileInputBar`
- `SceneZoomModal` — replaced by simpler `MobileImageViewer` on mobile
- `BriefList`, `BriefForm` — briefs gated out on mobile

---

## Key Files Modified

| File | Change |
|------|--------|
| `web/src/routes/+layout.svelte` | Add `mobileDetect.init()` to `onMount` |
| `web/src/routes/+page.svelte` | Branch on `isMobile`: `MobileHome` or desktop |
| `web/src/routes/session/+page.svelte` | Branch on `isMobile`: `MobileSession` or desktop |
| `web/src/routes/sessions/in-progress/+page.svelte` | Branch on `isMobile` for carousel |
| `web/src/routes/sessions/completed/+page.svelte` | Branch on `isMobile` for carousel |
| `web/src/routes/briefs/+page.svelte` | Mobile redirect guard |
| `web/src/routes/briefs/new/+page.svelte` | Mobile redirect guard |
| `web/src/routes/briefs/[id]/+page.svelte` | Mobile redirect guard |
| `web/src/routes/layout.css` | Add `.scrollbar-none` utility |
| `web/src/app.html` | Add `viewport-fit=cover` to viewport meta |

---

## Testing

### Unit tests (Vitest)
- `mobile-detect.test.ts` — store init, matchMedia, change events
- `mobile-prefs.test.ts` — text size cycling, localStorage persistence

### E2E tests (Playwright)
Leverage the existing `mobile-safari` project (iPhone 13 / WebKit / touch).

- **Home screen (J1-J3):** buttons render, disabled states, navigation
- **Carousel (J1-J3):** cards render, snap works, tap selects, dots, empty state
- **Reading mode (J4):** narration displays, top bar, action bar visible
- **Input mode (J5):** split screen, send works, returns to reading
- **Quick actions (J6):** move/talk pickers, search direct, end convo
- **Image viewer (J7):** tap image opens fullscreen, close works
- **Drawer (J8-J11):** opens/closes, status correct, help, themes, text size,
  quit
- **Briefs gating:** `/briefs` redirects to `/` on mobile
- **End state (J10):** outcome displays, tap navigates home

### Verification

After each phase, run `npm test` (the project quality gate).
