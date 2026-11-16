# UI

The UI is a terminal: typed commands in, text and one image out. Menus are
numbered lists picked by typing a number; `b` goes back. The only forms are the
profile picker and the settings page. Keep it that way — a new interaction
should be a command before it is a widget.

This doc holds the rules the code does not state. Per-route behaviour, component
props, and the command grammar live in the code; do not mirror them here.

## Shape

- SvelteKit on `adapter-node`, served by the same process as `/api`
  (`docs/architecture.md`). `src/routes/+layout.ts` sets `ssr = false`: it is a
  SPA. No `+page.server.ts` or `+layout.server.ts`; the only server code in
  `web/` is `src/routes/api/`.
- Pages talk to the engine through `callApi` in `src/lib/api/client.ts`. The
  store parses every answer with the shared schemas; a mismatch is logged and shown, never
  retried.
- Logic goes in plain `.ts` beside the rune stores in `src/lib/domain/`, not in
  components: that is what the web unit suite covers, and components are covered
  only by browser E2E.
- Components are all in `src/lib/components/`. Look there before adding one.

## The profile gate

`src/routes/+layout.svelte` sends every route except `PUBLIC_PATHS` (`/login`,
`/settings`) to `/login` until a profile is chosen. It renders nothing on a
protected route while that redirect is in flight — otherwise the page mounts and
fires its fetches signed out, and every session endpoint answers 401.

The gate is stricter than the server on purpose: you cannot play without a
profile, but the server asks for one only where a session is involved
("Identity and access" in `docs/architecture.md`). A route added to
`PUBLIC_PATHS` may therefore call only endpoints that need no profile.

## The session screen

Two keyboard rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler, and `InputBox` blurs itself. Moving the handler elsewhere makes the
  `Tab` toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50` with no stacking
  coordination; `openNotebook()` closing help is what keeps the notebook on top.

The browser sends each line to `game-turn` as typed; the engine owns the
grammar. `HelpModal` is the player's reference.

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
