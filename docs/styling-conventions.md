# Styling Conventions

This document outlines the styling rules for the UI.

## 1. Tailwind CSS

All styling must be done using **Tailwind CSS**.

- Use utility classes directly in the markup to maintain the text-adventure "terminal" aesthetic.
- Do not use CSS Modules.

## 2. Theme Color Tokens

All color classes must use the `t-*` theme tokens. Never hardcode Tailwind color names like `green-400` or `text-red-300`.

- `text-t-primary`, `bg-t-bg`, `border-t-muted/30` — correct
- `text-green-400`, `bg-black`, `border-green-500/30` — incorrect

See `docs/theming.md` for the full token reference and how to create new themes.

## 3. Custom CSS

- Avoid writing custom CSS in `<style>` blocks unless absolutely necessary for complex animations or scoping issues that Tailwind cannot solve cleanly.
- If custom CSS is required, it must be scoped to the Svelte component.

## 4. Global Styles

- Global base styles and theme CSS variables are defined in `src/routes/layout.css`.
- The Tailwind `@theme` block in `layout.css` maps CSS variables to Tailwind color utilities.
- Theme definitions live in `src/lib/domain/theme-store.svelte.ts`.

## 5. Responsive / Mobile

The app uses **component branching**, not Tailwind breakpoints, for mobile
layouts. Each route's `+page.svelte` checks `mobileDetect.isMobile` and renders
either the desktop component tree or a dedicated mobile component tree from
`src/lib/components/mobile/`.

### Detection pattern

```svelte
{#if !mobileDetect.isMobile}
  <DesktopView />
{:else}
  <MobileView />
{/if}
```

`MobileDetectStore` (`src/lib/domain/mobile-detect.svelte.ts`) uses
`matchMedia('(hover: none) and (pointer: coarse)')` to set `isMobile`.

### Safe-area insets

Mobile components must account for device notches and home indicators using
`env(safe-area-inset-*)` Tailwind classes:

- **Top bars**: `pt-[env(safe-area-inset-top)]` (e.g. `MobileTopBar`)
- **Bottom bars**: `pb-[env(safe-area-inset-bottom)]` (e.g. `MobileInputBar`,
  `MobileActionBar`)

The root `app.html` sets `<meta name="viewport" content="..., viewport-fit=cover">`
to enable inset values.

### Touch targets

Interactive elements in mobile components should have a minimum tap target of
**44px** to meet accessibility and usability guidelines.

### What not to do

- Do not use Tailwind responsive breakpoints (`sm:`, `md:`, `lg:`) for
  desktop-vs-mobile layout switching. Use `mobileDetect.isMobile` branching.
- Do not duplicate shared components. Reuse existing components (e.g.
  `NarrationBox`, `HelpModal`) inside both desktop and mobile trees.
