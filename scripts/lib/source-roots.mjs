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

/**
 * Where the grammar rule looks for an importer: the browser and the evaluation
 * harnesses. `evaluation/` is outside the layer rules and the quality limits;
 * only this one rule reaches it.
 */
export const GRAMMAR_ROOTS = ["web/src", "evaluation"];
