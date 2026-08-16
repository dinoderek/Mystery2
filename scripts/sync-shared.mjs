#!/usr/bin/env node
// Mirror shared source files into supabase/functions/.
//
// WHY A COPY AND NOT AN IMPORT
//
// The local edge runtime container bind-mounts ONLY `supabase/functions`:
//
//   /<repo>/supabase/functions -> /<repo>/supabase/functions
//
// so a relative import that escapes that directory (`../../../packages/...`)
// resolves to a path that does not exist inside the container. The edge copy
// therefore has to be a real file on disk under `supabase/functions`, and the
// canonical source has to live in `packages/shared` where the Node-side code,
// tests, and evaluation harnesses can import it. Hence: one canonical file,
// one verbatim copy, and this script to keep them identical.
//
// Only files with NO imports can be mirrored this way — the two runtimes
// resolve specifiers differently (`zod` vs `npm:zod`), so anything with an
// import needs a hand-written adapter instead (see
// supabase/functions/_shared/blueprints/blueprint-schema-v2.ts) and does not
// belong in MIRRORED_FILES.
//
// Usage:
//   node scripts/sync-shared.mjs           copy canonical -> copy
//   node scripts/sync-shared.mjs --check    exit 1 if any copy has drifted
//
// Exit codes:
//   0 — in sync (or copies written)
//   1 — drift detected in --check mode
//   2 — a canonical source is missing / unreadable

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Every verbatim mirror in the repo. `from` is canonical and the only file a
 * human should edit; `to` is overwritten wholesale.
 */
export const MIRRORED_FILES = [
  {
    from: "packages/shared/src/age-profile.ts",
    to: "supabase/functions/_shared/age-profile.ts",
  },
];

async function readOrNull(absolute) {
  try {
    return await fs.readFile(absolute, "utf-8");
  } catch {
    return null;
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const drifted = [];

  for (const entry of MIRRORED_FILES) {
    const fromAbs = path.join(REPO_ROOT, entry.from);
    const toAbs = path.join(REPO_ROOT, entry.to);

    const source = await readOrNull(fromAbs);
    if (source === null) {
      console.error(`ERROR: canonical source missing: ${entry.from}`);
      process.exit(2);
    }

    const current = await readOrNull(toAbs);
    if (current === source) continue;

    if (check) {
      drifted.push(entry);
      console.error(
        current === null
          ? `DRIFT ${entry.to} — copy is missing`
          : `DRIFT ${entry.to} — copy differs from ${entry.from}`,
      );
      continue;
    }

    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.writeFile(toAbs, source);
    console.log(`synced ${entry.from} -> ${entry.to}`);
  }

  if (drifted.length > 0) {
    console.error(
      `\n${drifted.length} mirrored file(s) out of sync. `
        + `Edit ONLY the canonical source, then run:\n\n  npm run sync:shared\n`,
    );
    process.exit(1);
  }

  console.log(
    check
      ? `OK: ${MIRRORED_FILES.length} mirrored file(s) in sync`
      : `OK: ${MIRRORED_FILES.length} mirrored file(s) up to date`,
  );
}

// Only run when invoked directly — tests import MIRRORED_FILES from here.
if (process.argv[1] && url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
