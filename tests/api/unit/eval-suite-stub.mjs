// A stand-in for every judge wrapper a suite calls. It counts its calls,
// answers from a table, and can play the Claude CLI at its usage limit.
//
// Usage (the runner spawns it with the binding's rendered args):
//   node eval-suite-stub.mjs <control-dir> <user-file>
//
// <control-dir> holds:
//   answers.json  the answer for each judge, by the user message's
//                 dimension_id (the age judge's message names none; it carries
//                 a target_age and is age_appropriate_turn)
//   calls.log     one line appended per call: the judge it answered
//   limit-after   optional: once this many calls are logged, every later call
//                 ends as the CLI does at the usage limit, and is not logged
//
// At the limit it prints what `claude --print --output-format json` prints for
// a call the API refused (the envelope of an error result, its text the
// message the CLI builds for the limit) and exits 1, as the CLI does.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [controlDir, userFile] = process.argv.slice(2);
const message = JSON.parse(fs.readFileSync(userFile, "utf8"));
const judge = message.dimension_id ?? (message.target_age === undefined ? "unknown" : "age_appropriate_turn");

const log = path.join(controlDir, "calls.log");
const made = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
const limitFile = path.join(controlDir, "limit-after");
if (fs.existsSync(limitFile) && made >= Number(fs.readFileSync(limitFile, "utf8"))) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      duration_ms: 412,
      duration_api_ms: 0,
      num_turns: 1,
      result: "You've hit your 5-hour limit · resets 3pm (Europe/London)",
      stop_reason: "stop_sequence",
      session_id: "00000000-0000-0000-0000-000000000000",
      total_cost_usd: 0,
    }),
  );
  process.exit(1);
}

fs.appendFileSync(log, `${judge}\n`);
const answers = JSON.parse(fs.readFileSync(path.join(controlDir, "answers.json"), "utf8"));
if (!(judge in answers)) {
  process.stderr.write(`eval-suite-stub: no answer for "${judge}"\n`);
  process.exit(2);
}
process.stdout.write(JSON.stringify({ result: JSON.stringify(answers[judge]) }));
