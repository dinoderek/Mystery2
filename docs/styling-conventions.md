# Styling Conventions

This document outlines the styling rules for the UI.

## 1. Tailwind CSS

All styling must be done using **Tailwind CSS**.

- Use utility classes directly in the markup to maintain the text-adventure "terminal" aesthetic.
- Do not use CSS Modules.

## 2. Custom CSS

- Avoid writing custom CSS in `<style>` blocks unless absolutely necessary for complex animations or scoping issues that Tailwind cannot solve cleanly.
- If custom CSS is required, it must be scoped to the Svelte component.

## 3. Global Styles

- Define global base styles (e.g., custom fonts, standard background colors that apply to the `<body>`) in `src/app.css` (or equivalent global stylesheet config).
- Rely on Tailwind's configuration (`tailwind.config.js`) for adding custom theme colors and font families.
