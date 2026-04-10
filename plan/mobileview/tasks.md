# Mobile UI — Task Cards

Reference: `plan/mobileview/plan.md` for user journeys (J1-J11), wireframes,
and component specifications.

---

## Execution Sequence & Parallelism

```
  T01 Infrastructure
   │
   ├──────────┬──────────┐
   │          │          │
  T02       T03        T04
  TopBar   Carousel   Prefs store
   │          │          │
   │     ┌────┘          │
   │     │               │
   ├─────┤               │
   │     │               │
  T05   T06              │
  Home   Session lists   │
   │     │               │
   ├─────┘               │
   │                     │
  T07                    │
  Playwright: Home       │
   │                     │
   ├──────────┬──────────┼──────────┐
   │          │          │          │
  T08       T09        T10        T11
  InputBar  ActionBar  Drawer    ImageViewer
   │        + Picker     │          │
   │          │          │          │
   └────┬─────┴──────────┴──────────┘
        │
       T12
       Session orchestrator
        │
       T13
       Playwright: Session
        │
       T14
       Polish + docs
```

**Parallel groups:**
- **Group A** (after T01): T02, T03, T04 — all independent leaf components/stores
- **Group B** (after T02+T03): T05, T06 — home and session lists
- **Group C** (after T02+T04, can overlap Group B): T08, T09, T10, T11 — session
  sub-components, all independent of each other
- T07 waits for T05+T06 (needs home + carousel integrated to test)
- T12 waits for T08+T09+T10+T11 (needs all sub-components)
- T13 waits for T12
- T14 waits for T13

---

## T01 — Infrastructure: mobile detection store + layout init

**Objective:** Create the shared `mobileDetect` store, wire it into the root
layout, create the `mobile/` component directory, and gate briefs routes.

**Journeys:** Foundation for all journeys.

**Do:**
- Create `web/src/lib/domain/mobile-detect.svelte.ts` with `MobileDetectStore`
  class exposing `isMobile: boolean` via `$state`. Use
  `matchMedia('(hover: none) and (pointer: coarse)')` with a `change` event
  listener. SSR-safe (`init()` no-ops when `window` is undefined).
- Create unit tests in `web/src/lib/domain/mobile-detect.test.ts`:
  - `isMobile` defaults to `false`
  - `init()` reads from mocked `matchMedia` and sets `isMobile`
  - `change` event listener updates `isMobile` reactively
- Add `mobileDetect.init()` call in `web/src/routes/+layout.svelte` inside
  `onMount`, alongside the existing `themeStore.init()`.
- Create the directory `web/src/lib/components/mobile/`.
- In `web/src/routes/briefs/+page.svelte`, `briefs/new/+page.svelte`, and
  `briefs/[id]/+page.svelte`: add an `onMount` guard that redirects to `/` if
  `mobileDetect.isMobile` is true.

**Don't:**
- Don't refactor `MobileBackButton` or `MobileKeyboardProxy` yet (defer).
- Don't create any visual components.
- Don't modify any desktop behaviour.

**Definition of done:**
- `mobile-detect.test.ts` passes.
- `npm test` passes.
- The `mobile/` directory exists.
- Briefs routes have the mobile redirect guard.
- Root layout calls `mobileDetect.init()`.

**Testing:**
- Unit tests for the store (described above).
- Manually verify `npm test` passes with no regressions.

---

## T02 — MobileTopBar component

**Objective:** Create the reusable top navigation bar used across all mobile
screens.

**Journeys:** J4, J8, J9, J10 (session), J1-J3 (selection screens).

**Do:**
- Create `web/src/lib/components/mobile/MobileTopBar.svelte`.
- Props: `title: string`, `turnsRemaining?: number`, `onback?: () => void`,
  `onmenu?: () => void`, `showMenu?: boolean` (default `true`).
- Layout: fixed-height bar (`h-12`). Back arrow button (left), truncated title
  (center-left), turns badge `[N]` (right of title, only if `turnsRemaining`
  is provided), hamburger icon (far right, only if `showMenu`).
- All touch targets minimum 44x44px.
- Use `t-*` theme tokens only. `font-mono`. Border-bottom `border-t-muted/30`.
- Back arrow: `←` character or SVG. Hamburger: three horizontal lines or `≡`.

**Don't:**
- Don't add safe area insets yet (T14).
- Don't handle drawer state — the parent manages that.
- Don't import any stores — this is a pure presentation component.

**Definition of done:**
- Component renders with all prop combinations (with/without turns,
  with/without menu, with/without back handler).
- Buttons trigger their callbacks on tap.
- Title truncates with ellipsis when long.
- Uses only `t-*` theme tokens.
- `npm test` passes.

**Testing:**
- Visual verification in browser at mobile viewport.
- Confirm touch target sizing via dev tools.

---

## T03 — MobileCarousel component + scrollbar CSS

**Objective:** Create the generic swipe carousel with peek edges and dot
indicators. Add the scrollbar-none utility CSS.

**Journeys:** J1 (blueprints), J2 (resume), J3 (history).

**Do:**
- Create `web/src/lib/components/mobile/MobileCarousel.svelte`.
- Props: `items: T[]`, `activeIndex: number` (bindable via `$bindable()`),
  `children: Snippet<[T, number]>`, `onselect?: (item: T, index: number) => void`,
  `emptyMessage?: string` (default "No items"), `loading?: boolean`.
- Container: horizontal scroll with `scroll-snap-type: x mandatory`,
  `-webkit-overflow-scrolling: touch`. Apply `.scrollbar-none`.
- Cards: `scroll-snap-align: center`, `flex-shrink: 0`, `width: 80vw`,
  `max-width: 320px`. Wrapped in a tappable div that calls `onselect`.
- Peek effect: horizontal padding `px-[10vw]` on container.
- Dot indicators below: row of dots, active = `bg-t-primary`,
  inactive = `bg-t-muted/30`. Tap dot scrolls to that card via
  `scrollIntoView({ behavior: 'smooth', inline: 'center' })`.
- Track active index via `scrollend` event. Include a `scroll` + debounce
  fallback (300ms) for older Safari.
- Loading state: show `TerminalSpinner` centered.
- Empty state: show `emptyMessage` centered.
- Add `.scrollbar-none` utility to `web/src/routes/layout.css`.

**Don't:**
- Don't add any gesture handling JS — CSS scroll-snap handles all physics.
- Don't add card content styling — that comes from the parent snippet.
- Don't install any npm packages.

**Definition of done:**
- Carousel renders items from a snippet, snaps on swipe, shows peek edges.
- Dot indicators track and respond to taps.
- Loading and empty states render correctly.
- Active index updates reactively on scroll.
- `.scrollbar-none` hides scrollbar on webkit and firefox.
- `npm test` passes.

**Testing:**
- Visual verification with 1, 3, and 5 dummy items in a test harness.
- Verify snap behaviour in mobile viewport (Chrome DevTools device mode).

---

## T04 — Mobile preferences store (text size)

**Objective:** Create the mobile preferences store for text size with
localStorage persistence.

**Journeys:** J11 (text size).

**Do:**
- Create `web/src/lib/domain/mobile-prefs.svelte.ts`.
- Export `mobilePrefs` singleton with:
  - `textSize: TextSize` (`$state`, type `'sm' | 'base' | 'lg'`, default `'base'`)
  - `init()` — reads from `localStorage` key `mystery-game-text-size`
  - `setTextSize(size: TextSize)` — sets value and persists
- Add `mobilePrefs.init()` call in `web/src/routes/+layout.svelte` inside
  `onMount`.
- Create unit tests in `web/src/lib/domain/mobile-prefs.test.ts`:
  - Defaults to `'base'`
  - `init()` loads saved value from localStorage
  - `init()` ignores invalid localStorage values
  - `setTextSize()` updates state and persists

**Don't:**
- Don't create any UI for this yet — the drawer (T10) will consume it.
- Don't add a `cycleTextSize()` method — the drawer uses radio buttons with
  `setTextSize()` directly.

**Definition of done:**
- Unit tests pass.
- `npm test` passes.
- Store persists and restores text size correctly.

**Testing:**
- Unit tests (described above).

---

## T05 — MobileHome component + route integration

**Objective:** Create the three-button home screen and the inline blueprint
carousel sub-view. Wire it into the home route.

**Journeys:** J1 (select blueprint), J2 (resume — navigation only), J3
(history — navigation only).

**Depends on:** T02 (MobileTopBar), T03 (MobileCarousel).

**Do:**
- Create `web/src/lib/components/mobile/MobileHome.svelte`.
- Two internal views: `'menu'` and `'new-game'` (local `$state`).
- **Menu view:** Three vertically stacked buttons — "Start New Case",
  "Resume Case (N)", "Case History (N)". Logout button top-right. Centered
  layout. Title "MYSTERY TERMINAL" at top.
  - "Start New Case" → sets view to `'new-game'`, calls
    `gameSessionStore.loadBlueprints()`.
  - "Resume Case" → `goto('/sessions/in-progress')`. Disabled when count is 0.
  - "Case History" → `goto('/sessions/completed')`. Disabled when count is 0.
  - Loads catalog on mount via `gameSessionStore.loadSessionCatalog(true)`.
- **New-game view:** `MobileTopBar` (title "Choose a Mystery", back arrow
  returns to menu, `showMenu={false}`) + `MobileCarousel` with blueprints.
  - Card snippet: `SignedImage` (cover image), title (`text-t-bright font-bold`),
    one-liner (`text-t-muted/80 text-sm`), target age (`text-t-dim text-xs`).
  - Card border: `border border-t-muted/30 bg-t-bg p-4`.
  - Tap card → `gameSessionStore.startGame(blueprint.id)` → on success
    `goto('/session')`. Show spinner during loading.
  - Footer hint text: "TAP CARD TO START".
- Minimum touch target: 48px height on all buttons.
- In `web/src/routes/+page.svelte`: wrap existing desktop markup in
  `{#if !mobileDetect.isMobile}...{:else}<MobileHome />{/if}`.
  The desktop code inside `{#if}` must remain **byte-identical**.

**Don't:**
- Don't modify any existing desktop code beyond wrapping it in the `{#if}`.
- Don't handle session list rendering — that's in the session list routes.
- Don't set `mobileKeyboard.inputMode` (tap-based, no proxy needed).

**Definition of done:**
- Mobile home shows three buttons with correct disabled states and counts.
- "Start New Case" opens blueprint carousel with swipe and tap-to-start.
- Back arrow returns to menu view.
- Desktop home page renders identically (no visual regression).
- `npm test` passes.

**Testing:**
- Visual verification at mobile viewport sizes (375px, 414px).
- Verify desktop is unchanged.

---

## T06 — Session list carousel integration (in-progress + completed)

**Objective:** Add mobile carousel layout to the in-progress and completed
session list routes.

**Journeys:** J2 (resume), J3 (history).

**Depends on:** T02 (MobileTopBar), T03 (MobileCarousel).

**Do:**
- In `web/src/routes/sessions/in-progress/+page.svelte`:
  - Wrap existing desktop markup in `{#if !mobileDetect.isMobile}`.
  - Add `{:else}` block with `MobileTopBar` (title "Resume Case",
    `onback={() => goto('/')}`, `showMenu={false}`) + `MobileCarousel`.
  - Card snippet: mystery title (`text-t-bright font-bold`), turns remaining,
    last played (formatted via `formatLastPlayed`).
  - Unavailable sessions (`!session.can_open`): dimmed card with warning text
    "Mystery file unavailable". Tap shows message instead of navigating.
  - Tap available card → `gameSessionStore.resumeSession(session.game_id)` →
    `goto('/session')`.
  - Empty state message: "No cases in progress".
  - Footer hint: "TAP CARD TO RESUME".
- In `web/src/routes/sessions/completed/+page.svelte`:
  - Same pattern. Title: "Case History".
  - Card snippet: mystery title, outcome (`formatOutcome`), last played.
  - Footer hint: "TAP CARD TO VIEW".
- Desktop markup inside `{#if}` must remain **byte-identical**.

**Don't:**
- Don't modify any desktop code beyond wrapping in `{#if}`.
- Don't change session loading logic — reuse the existing `onMount` load.

**Definition of done:**
- Both routes show carousel on mobile with correct card content.
- Tap-to-resume/view works.
- Unavailable sessions are dimmed and show warning.
- Empty state shows message.
- Desktop versions render identically.
- `npm test` passes.

**Testing:**
- Visual verification at mobile viewport.
- Verify desktop is unchanged.

---

## T07 — Playwright tests: home screen + carousel + briefs gating

**Objective:** E2E tests for the home screen and all carousel-based selection
flows on mobile.

**Journeys:** J1, J2, J3.

**Depends on:** T05 (MobileHome), T06 (session lists).

**Do:**
- Create `web/e2e/mobile-home.spec.ts` (or add to existing mobile spec
  structure — check Playwright config for `testMatch` patterns).
- Use the existing `mobile-safari` Playwright project (iPhone 13 / WebKit /
  touch emulation). Check the Playwright config for the project name and
  match pattern; adjust `testMatch` regex if needed to include new files.
- **Home screen tests:**
  - Three buttons render on mobile viewport.
  - "Resume Case" and "Case History" buttons are disabled when counts are 0.
  - "Resume Case" shows count badge when sessions exist.
  - No "Manage Briefs" button visible.
  - Logout button visible and functional.
- **Blueprint carousel tests:**
  - "Start New Case" tap shows carousel with blueprints.
  - Cards display title and cover image.
  - Dot indicators render and reflect card count.
  - Back arrow returns to three-button menu.
  - Tap card starts game (verify navigation to `/session`).
- **Session list tests:**
  - Navigate to `/sessions/in-progress` — carousel renders with session cards.
  - Cards show title, turns remaining, last played.
  - Back arrow returns to `/`.
  - Navigate to `/sessions/completed` — carousel renders with outcome.
- **Briefs gating test:**
  - Navigate to `/briefs` on mobile viewport — verify redirect to `/`.

**Don't:**
- Don't test desktop flows — those are covered by existing tests.
- Don't test session gameplay — that's T13.

**Definition of done:**
- All Playwright tests pass in the mobile-safari project.
- `npm test` passes.

**Testing:**
- Run `npx playwright test --project=mobile-safari` (or the configured project
  name) to verify.

---

## T08 — MobileInputBar component

**Objective:** Create the text input bar with send and cancel buttons for the
session screen's input mode.

**Journeys:** J5 (write input).

**Depends on:** T02 (uses similar styling patterns).

**Do:**
- Create `web/src/lib/components/mobile/MobileInputBar.svelte`.
- Props: `onsend: (text: string) => void`, `oncancel: () => void`,
  `disabled: boolean`, `placeholder: string`, `prefill?: string`.
- Layout: horizontal bar with ✕ cancel button (left), text input (center,
  flex-1), send button ➤ (right).
- Input: `font-size: 16px` (prevents iOS auto-zoom), `font-mono`,
  `bg-transparent`, `text-t-bright`, `placeholder-t-muted/50`.
- Send button: `w-12 h-12`, border `border-t-primary`, `text-t-primary`.
  Disabled state: `opacity-50`.
- Cancel button (✕): `w-12 h-12`, `text-t-muted`. Calls `oncancel`.
- Submit on Enter key or send button tap.
- If `prefill` is provided, set input value to it on mount.
- Auto-focus the input on mount so the keyboard rises.
- Clears input value after calling `onsend`.
- While disabled, input and send button are non-interactive.
- `t-*` theme tokens only.

**Don't:**
- Don't manage draft preservation — the parent (`MobileSession`) owns that
  state and passes/reads it via props.
- Don't import `gameSessionStore` — this is a pure presentation component.
- Don't add safe area insets yet (T14).

**Definition of done:**
- Component renders with input, send, and cancel buttons.
- Send fires `onsend` callback with input text.
- Cancel fires `oncancel` callback.
- Prefill sets initial input value.
- Auto-focuses input on mount.
- `npm test` passes.

**Testing:**
- Visual verification at mobile viewport.

---

## T09 — MobileActionBar + MobileListPicker components

**Objective:** Create the quick-action button bar and the reusable bottom-sheet
list picker for location/character selection.

**Journeys:** J6 (quick actions).

**Do:**
- Create `web/src/lib/components/mobile/MobileListPicker.svelte`.
  - Props: `title: string`, `items: { id: string, label: string, subtitle?: string }[]`,
    `onselect: (item) => void`, `oncancel: () => void`.
  - Bottom-sheet overlay: backdrop (`bg-t-bg/60`), panel slides up from bottom
    with `transition:slide`.
  - Title at top of panel. List of tappable rows below. Cancel button at bottom.
  - Each row: label in `text-t-bright`, optional subtitle in `text-t-muted/60
    text-xs` (used for character names in the location picker). Arrow indicator
    on right.
  - Touch target minimum 48px per row.
  - Tapping a row calls `onselect` and closes.
  - Tapping backdrop or cancel calls `oncancel`.
- Create `web/src/lib/components/mobile/MobileActionBar.svelte`.
  - Props: `onreply: () => void`, `oninputprefill: (text: string) => void`.
  - Reads `gameSessionStore.state.mode` and `gameSessionStore.status`.
  - **Explore mode buttons:** Move, Talk, Search (🔍), Accuse, Reply (💬).
  - **Talk mode buttons:** End convo, Reply (💬).
  - **Accuse mode:** Reply (💬) only, with label "State your reasoning".
  - Move → opens internal `MobileListPicker` with locations from
    `gameSessionStore.state.locations`. Each item includes a subtitle listing
    characters at that location (from `state.characters` filtered by
    `location_name`). Empty locations show "(empty)". On select, calls
    `gameSessionStore.submitInput('go to ' + item.label)`.
  - Talk → opens internal `MobileListPicker` with characters at current
    location. On select, calls
    `gameSessionStore.submitInput('talk to ' + item.label)`. Button disabled
    if no characters at current location.
  - Search → directly calls `gameSessionStore.submitInput('search')`.
  - End convo → directly calls `gameSessionStore.submitInput('bye')`.
  - Accuse → calls `oninputprefill('accuse ')`.
  - Reply → calls `onreply()`.
  - All buttons disabled when `gameSessionStore.status === 'loading'`.
  - Horizontal row of pill-shaped buttons with `gap-2`.
  - Fixed to bottom of container (the parent positions it).

**Don't:**
- Don't handle the floating reply button — `MobileSession` renders that
  separately.
- Don't integrate with `MobileSession` yet — that's T12.

**Definition of done:**
- `MobileListPicker` renders as a bottom-sheet with tappable rows and closes
  on selection or cancel.
- `MobileActionBar` shows correct buttons per game mode.
- Move opens location picker with character subtitles. Talk opens character
  picker. Search/End convo submit directly.
- All disabled when loading.
- `npm test` passes.

**Testing:**
- Visual verification with mocked game state at mobile viewport.

---

## T10 — MobileDrawer component

**Objective:** Create the slide-down drawer with status, actions, appearance,
and quit sections.

**Journeys:** J8 (help), J9 (status), J10 (quit), J11 (text size).

**Depends on:** T04 (mobile-prefs store).

**Do:**
- Create `web/src/lib/components/mobile/MobileDrawer.svelte`.
- Props: `open: boolean` (bindable via `$bindable()`).
- Uses `transition:slide` for the panel animation.
- Backdrop overlay (`bg-t-bg/60 fixed inset-0 z-40`) closes drawer on tap.
- Panel positioned below the top bar (`top-12`, or whatever the top bar height
  is), full width, `z-50`, `bg-t-bg`, `border-b border-t-muted/30`.
- **Status section:**
  - Location name (derived from `gameSessionStore.state.locations` by matching
    `state.location` — same logic as `StatusBar.svelte`).
  - Time remaining: `state.time_remaining`.
  - Characters at current location (same filter as `StatusBar.svelte`).
- **Actions section:**
  - Help button → sets `gameSessionStore.showHelp = true`, closes drawer.
  - Zoom button → sets `gameSessionStore.showZoomModal = true` (only shown if
    `gameSessionStore.activeStoryImage` is not null), closes drawer.
- **Appearance section:**
  - Theme picker: list of 5 themes from `themeStore.getThemeList()`. Radio-style
    selection. Tap to call `themeStore.setTheme(id)` + sync game store theme.
  - Text size: three radio options — Small, Medium, Large. Read/write
    `mobilePrefs.textSize` via `mobilePrefs.setTextSize()`.
- **Quit section:**
  - "End Session" button → calls `gameSessionStore.submitInput('quit')`, closes
    drawer.
- Close on: ✕ button tap, backdrop tap, or after an action that navigates away.

**Don't:**
- Don't manage drawer open/close state — the parent does via the bindable prop.
- Don't handle safe area insets yet (T14).

**Definition of done:**
- Drawer slides down with correct sections and data.
- Help opens the HelpModal.
- Zoom opens the SceneZoomModal (when image available).
- Theme changes apply immediately.
- Text size changes apply immediately.
- Quit triggers the quit flow.
- Drawer closes on backdrop tap and ✕.
- `npm test` passes.

**Testing:**
- Visual verification at mobile viewport.
- Verify theme and text size changes are reflected.

---

## T11 — MobileImageViewer component

**Objective:** Create the fullscreen image viewer overlay for mobile.

**Journeys:** J7 (view scene image).

**Do:**
- Create `web/src/lib/components/mobile/MobileImageViewer.svelte`.
- Props: `blueprintId: string`, `imageId: string`, `alt?: string`,
  `onclose: () => void`.
- Fixed overlay: `inset-0 z-50 bg-t-bg flex items-center justify-center`.
- Close button (✕) in top-right corner: `absolute top-4 right-4`, minimum
  44x44px touch target.
- Uses `SignedImage` internally with classes:
  `max-h-full max-w-full object-contain`.
- Close on: tap ✕ button, tap backdrop area outside the image.
- Pressing Escape closes the viewer.

**Don't:**
- Don't implement pinch-to-zoom (stretch goal, not in plan).
- Don't modify `NarrationBox` to add tap-to-zoom on images yet — that's part
  of T12 when wiring up `MobileSession`.

**Definition of done:**
- Image renders centered and fullscreen, respecting aspect ratio.
- ✕ button and backdrop tap close the viewer.
- Escape key closes the viewer.
- Uses `SignedImage` for signed URL handling.
- `npm test` passes.

**Testing:**
- Visual verification with a test image.

---

## T12 — MobileSession orchestrator + route integration

**Objective:** Create the main mobile session component that composes all
sub-components into the reading/input mode gameplay experience. Wire it into
the session route.

**Journeys:** J4 (read), J5 (write), J6 (quick actions), J7 (image), J8
(help), J9 (status), J10 (exit), J11 (text size).

**Depends on:** T02 (MobileTopBar), T08 (MobileInputBar), T09
(MobileActionBar + MobileListPicker), T10 (MobileDrawer), T11
(MobileImageViewer).

**Do:**
- Create `web/src/lib/components/mobile/MobileSession.svelte`.
- Internal state:
  - `sessionMode: 'reading' | 'input'` (default `'reading'`)
  - `drawerOpen: boolean` (default `false`)
  - `showImageViewer: boolean` (default `false`)
  - `activeViewerImageId: string | null`
  - `inputDraft: string` (preserved between mode switches)
  - `inputPrefill: string` (set by quick actions, cleared after use)
- **Route guard:** On mount, redirect to `/` if session is not active (same
  logic as existing `session/+page.svelte`).
- **Reading mode layout:**
  - `MobileTopBar`: title from blueprint, `turnsRemaining` from
    `state.time_remaining`, back → `goto('/')`, menu → toggle drawer.
  - `NarrationBox` (reused unchanged) filling the space between top bar and
    action bar. Apply `mobilePrefs.textSize` as CSS class on the narration
    container: `text-sm` / `text-base` / `text-lg`.
  - `MobileActionBar` fixed at bottom (explore/talk/accuse mode actions).
  - Floating reply button [💬] at bottom-right above action bar.
  - When `viewerMode === 'read_only_completed'`: hide action bar and reply
    button.
  - When `awaitingReturnToList` or end state: show full-screen end-state
    display (CASE SOLVED / CASE UNSOLVED). Tap anywhere → `goto('/')`.
- **Input mode layout:**
  - `MobileTopBar` (same as reading mode).
  - Top section: last interaction group — filter `state.history` to entries
    matching the highest sequence number, render with `TerminalMessage`.
  - `MobileInputBar` at bottom with `inputDraft` as value, placeholder based
    on `state.mode`.
  - On send: call `gameSessionStore.submitInput(text)`, clear `inputDraft`,
    switch to reading mode.
  - On cancel (✕): clear `inputDraft`, switch to reading mode.
  - If user navigates back to reading mode without cancel/send, `inputDraft`
    is preserved.
- **Overlays (always rendered, visibility toggled):**
  - `MobileDrawer` bound to `drawerOpen`.
  - `MobileImageViewer` shown when `showImageViewer` and `activeViewerImageId`.
  - `HelpModal` (existing, triggered by `gameSessionStore.showHelp`).
- **Image tap-to-zoom:** Images in the narration should be tappable on mobile
  to open `MobileImageViewer`. This requires wrapping `SignedImage` instances
  in the narration with a click handler. Check if this can be done by passing
  an `onclick` handler through `NarrationBox` or by adding a mobile-aware
  wrapper. If `NarrationBox` needs modification, keep changes minimal — add an
  optional `onimagetap` callback prop.
- Set `mobileKeyboard.inputMode = 'none'` on mount (the hidden proxy is not
  needed when real inputs are used).
- In `web/src/routes/session/+page.svelte`: wrap existing desktop markup in
  `{#if !mobileDetect.isMobile}...{:else}<MobileSession />{/if}`.
  Desktop code inside `{#if}` must remain **byte-identical**.

**Don't:**
- Don't modify any existing desktop session components (Header, StatusBar,
  InputBox).
- Don't create new stores — use existing `gameSessionStore`, `themeStore`,
  `mobilePrefs`.
- Don't implement safe area insets yet (T14).

**Definition of done:**
- Reading mode shows narration, top bar with turns, and action bar.
- Tapping reply opens input mode with preserved draft.
- Quick actions work (move, talk, search, accuse, end convo).
- Input mode shows last interaction + input bar.
- Send submits and returns to reading mode.
- Cancel clears and returns to reading mode.
- Drawer opens/closes with status, help, zoom, themes, text size, quit.
- Image viewer opens on image tap and zoom command.
- End state renders with tap-to-return.
- Read-only mode hides action bar and input.
- Text size from `mobilePrefs` applies to narration.
- Desktop session page renders identically.
- `npm test` passes.

**Testing:**
- Visual verification of all modes at mobile viewport.
- Verify desktop is unchanged.

---

## T13 — Playwright tests: session screen

**Objective:** E2E tests for the mobile session screen covering all in-narration
journeys.

**Journeys:** J4-J11.

**Depends on:** T12 (MobileSession integrated).

**Do:**
- Create `web/e2e/mobile-session.spec.ts` (adjust Playwright `testMatch` if
  needed).
- Use the existing `mobile-safari` Playwright project.
- **Reading mode tests (J4):**
  - Narration box displays history entries on session load.
  - Top bar shows mystery title and turns remaining.
  - Action bar shows mode-appropriate buttons (explore mode default).
  - Reply button (💬) is visible.
- **Input mode tests (J5):**
  - Tap reply button → input mode renders with last interaction and input bar.
  - Type text and tap send → input submitted, returns to reading mode.
  - Tap ✕ → returns to reading mode, input cleared.
  - Input draft preserved when switching back to reading without cancel.
  - Prefilled input from quick action shows pre-filled text.
- **Quick action tests (J6):**
  - Tap "Search" → search command submitted (new narration appears).
  - Tap "Move" → location picker opens with locations listed.
  - Tap a location → move command submitted.
  - Location picker shows characters at each location.
  - Tap "Talk" → character picker opens (only current location characters).
  - Tap a character → talk command submitted, mode switches to talk.
  - In talk mode: "End convo" button visible. Tap → bye submitted.
- **Image viewer tests (J7):**
  - Tap image in narration → fullscreen viewer opens.
  - Tap ✕ → viewer closes.
- **Drawer tests (J8, J9, J11):**
  - Tap hamburger → drawer opens with status info.
  - Status shows correct location, time, characters.
  - Tap "Help" → HelpModal opens.
  - Theme picker: tap a theme → theme applies.
  - Text size: tap "Large" → narration text size increases.
- **Exit tests (J10):**
  - Tap back arrow → navigates to `/`.
  - Tap "End Session" in drawer → quit flow triggers.
- **End state test:**
  - After case resolved, end-state screen shows outcome.
  - Tap anywhere → navigates to `/`.

**Don't:**
- Don't test desktop flows.
- Don't test home screen or carousel — those are in T07.

**Definition of done:**
- All Playwright tests pass in the mobile-safari project.
- `npm test` passes.

**Testing:**
- Run `npx playwright test --project=mobile-safari` (or configured name).

---

## T14 — Polish: safe area insets, viewport-fit, documentation

**Objective:** Add safe area inset handling for notched phones, update viewport
meta tag, verify all themes, and update documentation.

**Depends on:** T12 (all components exist), T13 (tests pass).

**Do:**
- Update `web/src/app.html`: change viewport meta to
  `content="width=device-width, initial-scale=1, viewport-fit=cover"`.
- Add safe area inset padding to:
  - `MobileTopBar`: `padding-top: env(safe-area-inset-top)` via Tailwind
    arbitrary value `pt-[env(safe-area-inset-top)]`.
  - `MobileInputBar` / `MobileActionBar`: `padding-bottom:
    env(safe-area-inset-bottom)`.
- Verify all 5 themes (classic, amber, ice, phosphor, noir) render correctly
  in: MobileHome, MobileCarousel cards, MobileSession (reading + input),
  MobileDrawer, MobileActionBar, MobileListPicker, MobileImageViewer.
- Update `docs/component-inventory.md`: add all new mobile components with
  purpose and props summary.
- Update `docs/screen-navigation.md`: add mobile flows, reference journeys
  J1-J11 from the plan.

**Don't:**
- Don't modify component behaviour — this is visual polish and docs only.
- Don't add new features.

**Definition of done:**
- `viewport-fit=cover` is in `app.html`.
- Safe area insets applied (verified in Safari dev tools / iPhone simulator).
- All 5 themes verified visually across all mobile components.
- `docs/component-inventory.md` updated.
- `docs/screen-navigation.md` updated.
- `npm test` passes.

**Testing:**
- Visual verification across themes at mobile viewport.
- Run full `npm test` as final quality gate.

---

## Task summary

| Task | Name | Depends on | Parallel group |
|------|------|------------|----------------|
| T01 | Infrastructure: store + layout + briefs gate | — | — |
| T02 | MobileTopBar | T01 | A |
| T03 | MobileCarousel + scrollbar CSS | T01 | A |
| T04 | Mobile prefs store (text size) | T01 | A |
| T05 | MobileHome + route integration | T02, T03 | B |
| T06 | Session list carousel integration | T02, T03 | B |
| T07 | Playwright: home + carousel + briefs | T05, T06 | — |
| T08 | MobileInputBar | T01 | C |
| T09 | MobileActionBar + MobileListPicker | T01 | C |
| T10 | MobileDrawer | T04 | C |
| T11 | MobileImageViewer | T01 | C |
| T12 | MobileSession orchestrator + route | T02, T08-T11 | — |
| T13 | Playwright: session screen | T12 | — |
| T14 | Polish: safe areas + docs | T12, T13 | — |
