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
