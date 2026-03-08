# Theming

The UI supports VSCode-style color themes that can be switched at runtime via terminal commands.

## Terminal Commands

- `themes` — List all available themes and the currently active one
- `theme <name>` — Switch to a theme by id or name (case-insensitive)

Theme commands work in any game mode and do not appear in the narration history.

## Available Themes

| ID | Name | Description |
|---|---|---|
| `classic` | Classic Green | Default green-on-black terminal |
| `amber` | Amber | Warm amber/orange CRT terminal |
| `ice` | Ice | Cool blue/cyan terminal |
| `phosphor` | Phosphor | High-contrast white/green CRT |
| `noir` | Noir | Desaturated grayscale noir |

## Color Token System

Themes define 8 color tokens + 1 derived glow value:

| Token | CSS Variable | Role |
|---|---|---|
| `bg` | `--t-bg` | Page background |
| `primary` | `--t-primary` | Primary text, headings, interactive elements |
| `bright` | `--t-bright` | Player input, highlights, success states |
| `muted` | `--t-muted` | System/narrator text, base accent for borders |
| `dim` | `--t-dim` | Tertiary info text |
| `dialogue` | `--t-dialogue` | Character dialogue text |
| `error` | `--t-error` | Error and failure states |
| `warning` | `--t-warning` | Warnings, retry indicators |
| `glow` | `--t-glow` | Shadow glow color (rgba from `muted` at 30%) |

### Derived Colors

Borders, subtle backgrounds, hover states, and scrollbar colors are derived using Tailwind opacity modifiers on the tokens above:

- Borders: `border-t-muted/20`, `border-t-muted/30`, `border-t-muted/50`
- Subtle backgrounds: `bg-t-muted/5`, `bg-t-muted/10`
- Hover states: `hover:bg-t-muted/10`, `hover:bg-t-dialogue/10`
- Selection: `selection:bg-t-muted/30`
- Glow: `shadow-[0_0_15px_var(--t-glow)]`

## Creating a New Theme

1. Open `web/src/lib/domain/theme-store.svelte.ts`
2. Add a new entry to the `THEMES` array:

```typescript
{
  id: 'my-theme',
  name: 'My Theme',
  colors: {
    bg: '#000000',
    primary: '#...',
    bright: '#...',
    muted: '#...',
    dim: '#...',
    dialogue: '#...',
    error: '#...',
    warning: '#...',
    glow: 'rgba(R, G, B, 0.3)',  // use the muted color's RGB at 30%
  },
},
```

The theme is immediately available via the `theme my-theme` command.

## Technical Architecture

1. `:root` CSS variables hold the active theme's color values
2. Tailwind v4's `@theme` directive in `layout.css` maps these to Tailwind color utilities (`text-t-primary`, `bg-t-bg`, etc.)
3. Components use theme-aware Tailwind classes exclusively
4. `ThemeStore` applies themes by setting CSS custom properties on `document.documentElement`
5. Theme preference is persisted to `localStorage` under `mystery-game-theme`

## Key Files

- `web/src/lib/domain/theme-store.svelte.ts` — Theme definitions, store, CSS application
- `web/src/routes/layout.css` — CSS variables + Tailwind `@theme` block
- `web/src/lib/domain/parser.ts` — Theme command parsing
- `web/src/lib/domain/store.svelte.ts` — Theme command handling (silent, no narration echo)
