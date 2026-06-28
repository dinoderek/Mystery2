// Model-backend registry.
//
// A ModelBackend collects a Transcript for a test case. Every backend exposes:
//   id: string
//   collect(testCase, ctx) -> Promise<{ transcript, blueprint, blueprintPath, model }>
//
// The backend id may carry a sub-selector after a colon, e.g. "cli:claude".
// `loadBackend` resolves the base id and passes the variant through ctx.variant.

import * as endpoint from "./endpoint.mjs";

const REGISTRY = new Map([[endpoint.id, endpoint]]);

/**
 * Resolve a backend spec ("endpoint", "cli:claude") to a backend module and the
 * variant string (the part after the colon, or null).
 */
export async function loadBackend(spec) {
  const [base, variant = null] = String(spec).split(":");
  let backend = REGISTRY.get(base);
  if (!backend && base === "cli") {
    // Lazily import the CLI backend so its Deno/CLI dependencies are only
    // required when actually requested.
    backend = await import("./cli.mjs");
    REGISTRY.set(base, backend);
  }
  if (!backend) {
    throw new Error(
      `Unknown backend "${spec}". Known: ${[...REGISTRY.keys()].join(", ")}, cli`,
    );
  }
  return { backend, variant };
}
