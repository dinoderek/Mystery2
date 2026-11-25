# UI

The terminal UI takes typed commands and shows text and scene art. Only the
profile picker, settings and game input are forms. New interactions are commands
before widgets.

## Menus

Each landing-menu row, case card and session row is a button with its number,
disabled where it cannot open; `[ BACK ]` is tappable wherever `b` goes back. A
tap calls its key's function, never a synthetic key event.

## Shape

- A SPA (`ssr = false`); the only server code in `web/` is `src/routes/api/`
  (`docs/architecture.md`).
- Pages call the engine through `callApi` (`src/lib/api/client.ts`); the store
  parses answers with the shared schemas, logging and showing a mismatch, never
  retrying it.
- Logic goes in plain `.ts` in `src/lib/domain/`.

## The profile gate

`src/routes/+layout.svelte` sends every route except `PUBLIC_PATHS` (`/login`,
`/settings`) to `/login` until a profile is chosen. A `PUBLIC_PATHS` route calls
a profile endpoint only once one is chosen.

## The session screen

Case selection and opening pages preview the first scene; cards are
stills. In play, scenes follow the viewed location, history included, and
conversations prefer portraits. Scenes respect reduced motion; WebGL scenes
stay still. Scene failures fall back to illustrations.

Enter, the keyboard's action key and `[ SEND ]` submit the input's form, never
`keydown`; dictation arrives as plain input. The input is 16 px (iOS zooms
below). On a coarse pointer it takes focus after a tap or a sent line only. The
begin and end prompts are buttons that also take any key, once. Key hints show
only under `pointer: fine`.

## Layout

From 360 px wide, portrait and landscape, nothing scrolls sideways and every
control is at least 44 px in its smaller side. Full-height
screens use `dvh`, never `h-screen` or `vh`. Below `lg:` art stacks above text.
The session screen follows the visual viewport (`domain/viewport.ts`), so the
input and latest narration stay visible with the on-screen keyboard up: art
gives up height first, is gone under 96 px, and below 480 px the header and
character row go too.

Two rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler and `InputBox` blurs itself. Moving the handler makes the `Tab`
  toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50`; `openNotebook()` closing
  help keeps the notebook on top.

The browser sends each line to `game-turn` as typed; the engine owns the grammar.

A clue-graph case (`docs/clue-graph.md`) adds to CLUES: leads first, each
`[ NEW ]` on its turn, then clues; a retracted statement is struck through, a
noticed tell labelled.

## Styling

- Tailwind utilities; a scoped `<style>` block only for what they cannot express.
- Colours only through the tokens (`text-t-primary`, `bg-t-bg`), never a
  palette colour; borders, hovers and subtle backgrounds are opacity modifiers
  (`border-t-muted/30`). Tokens are CSS variables in
  `src/routes/layout.css`, mapped through `@theme`.
- No shared form-control component: copy rows and text inputs from
  `ProfilePicker.svelte`, the selected state (`aria-pressed`) from
  `src/routes/settings/+page.svelte`. Buttons are labelled `[ START ]`.
