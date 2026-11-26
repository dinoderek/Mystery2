# UI

The terminal UI takes typed commands and shows text and scene art. Only the
profile picker, settings and game input are forms; prefer commands to widgets.

## Menus

Each landing-menu row, case card and session row is a numbered button,
disabled where it cannot open; `[ BACK ]` is tappable wherever `b` goes back. A
tap calls its key's function, never a synthetic key event.

Cards show titles at once, then lines narrated at the profile's age (asked anew
each visit; none on failure).

## Shape

- A SPA (`ssr = false`); `web/`'s only server code is `src/routes/api/`
  (`docs/architecture.md`).
- Pages call the engine through `callApi` (`src/lib/api/client.ts`); the store
  parses answers with the shared schemas, logging and showing a mismatch, unretried.
- Logic goes in plain `.ts` in `src/lib/domain/`.

## The profile gate

`src/routes/+layout.svelte` sends every route except `PUBLIC_PATHS` (`/login`,
`/settings`) to `/login` until a profile is chosen. A `PUBLIC_PATHS` route calls
a profile endpoint only once one is chosen.

A new name is asked its age (`AgePicker.svelte`, also on settings); a
game refused with `READING_AGE_REQUIRED` opens it too.

## The session screen

Case selection and opening pages preview the first scene; cards are
stills. In play, scenes follow the viewed location, history included; talking
prefers portraits. Scenes respect reduced motion (WebGL ones stay still) and
fall back to illustrations on failure.

Enter, the keyboard's action key and `[ SEND ]` submit the input's form, never
`keydown`; dictation arrives as plain input. The input is 16 px (iOS zooms
below). On a coarse pointer it takes focus after a tap or a sent line only. The
begin and end prompts are buttons that also take any key, once. Key hints need
`pointer: fine`.

## Layout

From 360 px wide, in either orientation, nothing scrolls sideways and every
control is at least 44 px on its shorter side. Full-height
screens use `dvh`, never `h-screen` or `vh`. Below `lg:` art stacks above text.
The session screen follows the visual viewport (`domain/viewport.ts`), keeping
the input and latest narration visible with the keyboard up: art shrinks first,
vanishes under 96 px, and below 480 px the header and character row go too.

Two rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler and `InputBox` blurs itself. Moving the handler makes the `Tab`
  toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50`; `openNotebook()` closing
  help keeps the notebook on top.

The browser sends each line to `game-turn` as typed.

CLUES lists leads first, each `[ NEW ]` on its turn, then clues; a retracted
statement is struck through, a noticed tell labelled.

## Styling

- Tailwind utilities; a scoped `<style>` only where they fall short.
- Colours only through tokens (`text-t-primary`, `bg-t-bg`), never palette
  colours; borders, hovers and subtle backgrounds are opacity modifiers
  (`border-t-muted/30`). Tokens live in `src/routes/layout.css`.
- No shared form-control: copy text inputs from `ProfilePicker.svelte`, the
  selected state (`aria-pressed`) from `AgePicker.svelte`. Buttons read `[ START ]`.
