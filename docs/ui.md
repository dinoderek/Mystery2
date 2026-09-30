# UI

The UI is a terminal: typed commands in, text and one image out. Menus are
numbered lists picked by typing a number; `b` goes back. The only forms are the
profile picker and the AI settings page. Keep it that way — a new interaction
should be a command before it is a widget.

This doc holds the rules the code does not state. Per-route behaviour, component
props, and the command grammar live in the code; do not mirror them here.

## Shape

- SvelteKit on `adapter-node`, served by the same process as `/api`
  (`docs/architecture.md`). `src/routes/+layout.ts` sets `ssr = false`: it is a
  SPA. No `+page.server.ts` or `+layout.server.ts`; the only server code in
  `web/` is `src/routes/api/`.
- Pages talk to the engine through `callApi(name, body)` in
  `src/lib/api/client.ts`, which returns `{ data, error }`.
- State is in rune stores, `src/lib/domain/*.svelte.ts`. `gameSessionStore`
  (`store.svelte.ts`) owns the session, its pages, the notebook and help.
- Logic goes in plain `.ts` beside the stores (`parser.ts`, `session-pages.ts`,
  `notebook.ts`, `store.retry.ts`), not in components. That is what the web unit
  suite covers; components are covered only by browser E2E.
- Components are in `src/lib/components/` (the session screen) and
  `src/lib/ui/` (`ProfilePicker`). Look in both before adding one.

| Route | Screen |
|---|---|
| `/` | Menu: new game, in-progress, completed |
| `/sessions/in-progress`, `/sessions/completed` | Numbered session lists; completed ones open read-only |
| `/session` | The game |
| `/login` | Profile picker |
| `/settings` | AI settings (`docs/ai-configuration.md`) |

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

Narration takes the left third, `ScenePane` (a fixed image) the right two
thirds. The transcript is split into pages by `session-pages.ts` — a new page on
`start`, `move`, `talk`, `end_talk` and `accuse_start` — and the scene image is
whatever the active page carries.

Two keyboard rules are easy to break:

- While the notebook is open, `NotebookPanel` owns every key through one window
  handler, and `InputBox` blurs itself. Moving the handler elsewhere makes the
  `Tab` toggle depend on listener order.
- `HelpModal` and `NotebookPanel` both sit at `z-50` with no stacking
  coordination; `openNotebook()` closing help is what keeps the notebook on top.

`parser.ts` is the command grammar and `HelpModal` is the player's reference to
it. `docs/game.md` describes commands at the player level only.

## Styling

- Tailwind utilities only. No CSS modules; a `<style>` block only for what
  Tailwind cannot express, scoped to the component.
- Colours only through the theme tokens — `text-t-primary`, `bg-t-bg`,
  `border-t-muted/30` — never a palette colour like `text-green-400`. Borders,
  hovers and subtle backgrounds are opacity modifiers on a token.
- The tokens are `bg`, `primary`, `bright`, `muted`, `dim`, `dialogue`,
  `error`, `warning`, plus `glow` (the muted colour at 30%, for shadows).
  `src/routes/layout.css` maps them to Tailwind through `@theme`.
- Themes are the `THEMES` array in `src/lib/domain/theme-store.svelte.ts`;
  adding an entry is all it takes. Players switch with `themes` /
  `theme <name>`, and the choice is kept in `localStorage`.
- There is no shared form-control component. Copy the classes: selectable rows
  and text inputs from `ProfilePicker.svelte`, the selected state
  (`aria-pressed`) from `src/routes/settings/+page.svelte`. Buttons are
  labelled in brackets: `[ START ]`.

## Keeping this doc current

Change it when a rule above changes: the gate, the key ownership, the styling
rules, or where things live. A new component, route behaviour or command does
not belong here.
