#!/usr/bin/env node
/**
 * Fails when a function breaks a quality limit that the baseline does not
 * list, or when a baseline entry no longer applies. Part of phase 1 of the
 * gate (`npm run check:quality`). `--prune` removes stale entries.
 */

import process from "node:process";

import { runQuality } from "./lib/check-quality.mjs";

const { status, output } = runQuality({
  prune: process.argv.includes("--prune"),
});
if (status === 0) {
  process.stdout.write(
    `OK: no function breaks a quality limit outside the baseline\n`,
  );
} else {
  process.stderr.write(output);
}
process.exit(status);
