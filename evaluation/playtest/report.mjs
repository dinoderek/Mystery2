#!/usr/bin/env node
// Playtest report — writes <run>/report.html for a run folder on disk.
//
//   npm run eval:playtest:report -- evaluation/playtest/runs/<run>
//
// eval:playtest writes the same page at the end of every run; this rebuilds
// it, for a run graded by hand afterwards or one made before the page existed.
// See evaluation/playtest/README.md.

import fs from "node:fs";
import path from "node:path";

import { writeReport } from "./lib/report.mjs";

const USAGE = `Usage: npm run eval:playtest:report -- <run folder>

Writes report.html into a playtest run folder: every game's transcript on one
page, with each judge finding beside the turn it cites. Reads the folder's
game.db, each game's steps.jsonl and, when the games were graded, their
result.json and readability.json.
`;

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(USAGE);
  process.exit(args.length === 1 ? 0 : 1);
}

const runDir = path.resolve(args[0]);
if (!fs.existsSync(path.join(runDir, "game.db"))) {
  process.stderr.write(`${args[0]} is not a playtest run folder: it has no game.db.\n`);
  process.exit(1);
}

const file = writeReport(runDir);
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
