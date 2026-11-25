# UI

The terminal UI takes typed commands and shows text and scene art. Menus use
numbers; `b` goes back. Only the profile picker, settings and game input are
forms. New interactions should be commands before widgets.

## Menus

Each landing-menu row, case card and session row is a button carrying its
number, disabled where it cannot open; `[ BACK ]` is tappable wherever `b` goes
back. A tap calls its key's function, never a synthetic key event.

## Shape

- SvelteKit on `adapter-node`, served with `/api` by one process
  (`docs/architecture.md`); `+layout.ts` sets `ssr = false`: a SPA. The only
  server code in `web/` is `src/routes/api/`.
- Pages call the engine through `callApi` (`src/lib/api/client.ts`). The store
  parses answers with the shared schemas; a mismatch is logged and shown, never
  retried.
- Logic goes in plain `.ts` in `src/lib/domain/`, not in components, which only
  browser E2E covers.

## The profile gate

`src/routes/+layout.svelte` sends every route except `PUBLIC_PATHS` (`/login`,
`/settings`) to `/login` until a profile is chosen, rendering nothing meanwhile.
The gate is stricter than the server on purpose. A `PUBLIC_PATHS` route calls a
profile endpoint only once one is chosen.

## The session screen

Case selection and opening pages preview the first scene recipe; cards are
stills. In play, scenes follow the viewed location, history included, and
conversations prefer portraits. Scenes respect reduced motion; WebGL scenes
stay still. Failures log once and fall back to illustrations. Narrow screens
stack art above narration and input.

Enter, the keyboard's action key, dictation and `[ SEND ]` submit the input's
form, never `keydown`. It is 16 px (smaller zooms iOS). On a coarse pointer it
takes focus after a tap or a sent line only. The begin and end prompts are
buttons that also take any key, once. Key hints show only under `pointer: fine`.

Two keyboard rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler and `InputBox` blurs itself. Moving the handler makes the `Tab`
  toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50`, uncoordinated;
  `openNotebook()` closing help keeps the notebook on top.

The browser sends each line to `game-turn` as typed; the engine owns the
grammar. `HelpModal` has the accusation rule.

A clue-graph case (`docs/clue-graph.md`) adds to CLUES: leads first, each
`[ NEW ]` on its turn, then clues; a retracted statement is struck through, a
noticed tell labelled.

## Styling

- Tailwind utilities only. No CSS modules; a scoped `<style>` block only for
  what Tailwind cannot express.
- Colours only through the tokens (`text-t-primary`, `bg-t-bg`,
  `border-t-muted/30`), never a palette colour like `text-green-400`; borders,
  hovers and subtle backgrounds are opacity modifiers on a token.
- One palette, green on black, no theme switching. Tokens are CSS variables on
  `:root` in `src/routes/layout.css`, mapped to Tailwind through `@theme`.
- No shared form-control component: copy the classes of rows and text inputs
  from `ProfilePicker.svelte`, the selected state (`aria-pressed`) from
  `src/routes/settings/+page.svelte`. Buttons are labelled `[ START ]`.
