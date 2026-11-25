# UI

The terminal UI takes typed commands and shows text and scene art. Menus use
numbers; `b` goes back. Only the profile picker and settings use forms.
New interactions should be commands before widgets.

## Shape

- SvelteKit on `adapter-node`, served by the same process as `/api`
  (`docs/architecture.md`). `src/routes/+layout.ts` sets `ssr = false`: it is a
  SPA. No `+page.server.ts` or `+layout.server.ts`; the only server code in
  `web/` is `src/routes/api/`.
- Pages talk to the engine through `callApi` in `src/lib/api/client.ts`. The
  store parses every answer with the shared schemas; a mismatch is logged and
  shown, never retried.
- Logic goes in plain `.ts` beside the rune stores in `src/lib/domain/`, not in
  components, which only browser E2E covers.
- Components live in `src/lib/components/`.

## The profile gate

`src/routes/+layout.svelte` sends every route except `PUBLIC_PATHS` (`/login`,
`/settings`) to `/login` until a profile is chosen. It renders nothing on a
protected route meanwhile, or the page mounts and fetches signed out, getting
401s.

The gate is stricter than the server on purpose: the server asks for a profile
only where something owned is involved ("Identity and access" in
`docs/architecture.md`). A `PUBLIC_PATHS` route calls a profile endpoint only
once one is chosen; settings sets the reading age (`docs/game.md`).

## The session screen

Case selection and opening pages preview the first scene recipe; visible cards are
stills. During play, scenes follow the viewed location, including history.
Conversations prefer portraits, otherwise scenery. Scenes respect reduced motion;
frame pacing preserves input responsiveness. Failures log once and fall back to
illustrations. WebGL scenes stay still. Narrow screens stack art above narration and input.

Two keyboard rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler, and `InputBox` blurs itself. Moving the handler elsewhere makes the
  `Tab` toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50` with no stacking
  coordination; `openNotebook()` closing help is what keeps the notebook on top.

The browser sends each line to `game-turn` as typed; the engine owns the
grammar. The status bar shows ACCUSATIONS left beside TIME; `HelpModal` has the rule.

A clue-graph case (`docs/clue-graph.md`) adds to CLUES: leads first, each
`[ NEW ]` on its turn, then clues, a statement taken back struck through, a
noticed tell labelled.

## Styling

- Tailwind utilities only. No CSS modules; a `<style>` block only for what
  Tailwind cannot express, scoped to the component.
- Colours only through the tokens — `text-t-primary`, `bg-t-bg`,
  `border-t-muted/30` — never a palette colour like `text-green-400`. Borders,
  hovers and subtle backgrounds are opacity modifiers on a token.
- There is one palette, green on black, and no theme switching. The tokens are
  CSS variables on `:root` in `src/routes/layout.css`, mapped to Tailwind
  through `@theme`; a colour change is an edit there and nowhere else.
- There is no shared form-control component. Copy the classes: selectable rows
  and text inputs from `ProfilePicker.svelte`, the selected state
  (`aria-pressed`) from `src/routes/settings/+page.svelte`. Buttons are
  labelled in brackets: `[ START ]`.
