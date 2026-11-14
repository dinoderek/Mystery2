/**
 * The code the quality limits and the import-layer rules cover: the engine,
 * the shared package and the web app (TypeScript, not their tests), and the
 * `evaluation/`, `scripts/` and `lib/` trees (JavaScript and TypeScript).
 */
export const SOURCE_ROOTS = [
  "packages/game-engine/src",
  "packages/shared/src",
  "web/src",
  "evaluation",
  "scripts",
  "lib",
];
