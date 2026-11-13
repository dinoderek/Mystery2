/**
 * The TypeScript the quality limits and the import-layer rules cover:
 * `packages/game-engine`, `packages/shared` and the web app, not their tests.
 * `evaluation/`, `scripts/` and `lib/` are outside both.
 */
export const SOURCE_ROOTS = [
  "packages/game-engine/src",
  "packages/shared/src",
  "web/src",
];
