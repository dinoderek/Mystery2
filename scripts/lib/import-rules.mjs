/**
 * The import-layer rules, in `dependency-cruiser`'s `forbidden` format. Paths
 * are repo-relative. They apply to `SOURCE_ROOTS`; the baseline of known
 * violations is described in `docs/testing.md`.
 */

const ENGINE = "^packages/game-engine/src/";
const SHARED = "^packages/shared/src/";
const ENGINE_DB = "^packages/game-engine/src/db/";
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
    comment: "Only context-local.ts and db/ import db/.",
    severity: "error",
    from: {
      path: ENGINE,
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
];
