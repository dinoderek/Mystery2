/**
 * The import-layer rules, in `dependency-cruiser`'s `forbidden` format. Paths
 * are repo-relative. They apply to `SOURCE_ROOTS`; the baseline of known
 * violations is described in `docs/testing.md`.
 */

const ENGINE = "^packages/game-engine/src/";
const SHARED = "^packages/shared/src/";
const ENGINE_DB = "^packages/game-engine/src/db/";
const EVALUATION = "^evaluation/";
const EVALUATION_CORE = "^evaluation/core/";
/** The trace extractor, the one evaluation module that resolves the play database path. */
const TRACE_EXTRACTOR = "^evaluation/trace/lib/datasource\\.(mjs|ts)$";
/** Everything in the repo that is source rather than a dependency. */
const REPO_CODE = "^(packages|web|evaluation|tests|scripts|lib)/";

export const FORBIDDEN = [
  {
    name: "no-cycles",
    comment: "Modules do not import each other in a ring.",
    severity: "error",
    from: {},
    to: { circular: true },
  },
  {
    name: "shared-imports-only-shared",
    comment: "packages/shared imports no other code in this repo.",
    severity: "error",
    from: { path: SHARED },
    to: { path: REPO_CODE, pathNot: SHARED },
  },
  {
    name: "engine-imports-engine-and-shared",
    comment: "packages/game-engine imports only itself and packages/shared.",
    severity: "error",
    from: { path: ENGINE },
    to: { path: REPO_CODE, pathNot: [ENGINE, SHARED] },
  },
  {
    name: "sqlite-driver-only-in-db-client",
    comment: "Only db/client.ts imports the SQLite driver.",
    severity: "error",
    from: { pathNot: "^packages/game-engine/src/db/client\\.ts$" },
    to: {
      path: ["(^|/)node_modules/(@types/)?better-sqlite3/", "^(node:)?sqlite$"],
    },
  },
  {
    name: "db-only-from-context-local",
    comment: "Only context-local.ts and db/ import db/; the web app never does.",
    severity: "error",
    from: {
      path: [ENGINE, "^web/src/"],
      pathNot: ["^packages/game-engine/src/context-local\\.ts$", ENGINE_DB],
    },
    to: { path: ENGINE_DB },
  },
  {
    name: "browser-code-avoids-engine-and-server",
    comment:
      "Only routes/api, lib/server and hooks.server.ts import the engine or $lib/server.",
    severity: "error",
    from: {
      path: "^web/src/",
      pathNot: [
        "^web/src/routes/api/",
        "^web/src/lib/server/",
        "^web/src/hooks\\.server\\.ts$",
      ],
    },
    to: { path: ["^packages/game-engine/", "^web/src/lib/server/"] },
  },
  {
    name: "domain-avoids-components-and-routes",
    comment: "web/src/lib/domain never imports components or routes.",
    severity: "error",
    from: { path: "^web/src/lib/domain/" },
    to: { path: ["^web/src/lib/components/", "^web/src/routes/"] },
  },
  {
    name: "grammar-only-in-engine",
    comment:
      "Only packages/game-engine imports the command grammar: the engine decides what a typed line means, and the browser and the evaluation harnesses do not.",
    severity: "error",
    from: { path: "^(web|evaluation)/" },
    to: { path: "^packages/game-engine/src/command-grammar\\.ts$" },
  },
  {
    name: "evaluation-imports-only-what-it-may",
    comment:
      "evaluation/ imports the engine, packages/shared and packages/blueprint-generator, and from web/ only the notebook and the retry rule, which it uses to see what a player sees.",
    severity: "error",
    from: { path: EVALUATION },
    to: {
      path: "^(packages|web|tests)/",
      pathNot: [
        "^packages/(game-engine|shared|blueprint-generator)/",
        "^web/src/lib/domain/(notebook|store\\.retry)\\.ts$",
      ],
    },
  },
  {
    name: "nothing-imports-evaluation",
    comment: "No code in packages/ or web/ imports evaluation/.",
    severity: "error",
    from: { path: "^(packages|web)/" },
    to: { path: EVALUATION },
  },
  {
    name: "model-subprocess-only-in-evaluation-core",
    comment:
      "Only evaluation/core/ starts a model subprocess, so a retry or a timeout is written once. Importing node:child_process, or the engine's Claude CLI call, from the rest of evaluation/ is a second way to start one.",
    severity: "error",
    from: { path: EVALUATION, pathNot: EVALUATION_CORE },
    to: {
      path: [
        "^(node:)?child_process$",
        "^packages/game-engine/src/ai-provider-claude-cli\\.ts$",
      ],
    },
  },
  {
    name: "play-database-path-only-in-trace-extractor",
    comment:
      "Only the trace extractor resolves the play database path, and it opens that database read-only. Evaluation otherwise works on a database it created.",
    severity: "error",
    from: { path: EVALUATION, pathNot: TRACE_EXTRACTOR },
    to: {
      path: [
        "^packages/game-engine/src/paths\\.ts$",
        "^lib/database-target\\.mjs$",
      ],
    },
  },
];
