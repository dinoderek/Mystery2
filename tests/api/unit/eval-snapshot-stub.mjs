// A stand-in for a judge or generator CLI wrapper that records what it was
// sent and answers from a table. The evaluation snapshot tests point every
// harness at it, so the exact prompt each model would have received is on disk
// and no model is called.
//
// Usage (the harness spawns it with the rendered args):
//   node eval-snapshot-stub.mjs <capture-dir|-> <answers.json> <key> <system-file> <user-file>
//
// <key> names the call. A `{id}` in it is replaced by the `dimension_id` of the
// user message, so one binding serves every judge of a harness
// ("trace.{id}" -> "trace.gm_roleplay"). The system prompt and user message go
// to <capture-dir>/<key>.system.txt and <key>.user.txt, unless <capture-dir>
// is "-". The reply is the Claude CLI envelope, {"result": "<answer>"}, with
// the answer taken from <answers.json>[<key>].

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [captureDir, answersFile, keyTemplate, systemFile, userFile] = process.argv.slice(2);

const system = fs.readFileSync(systemFile, "utf8");
const user = fs.readFileSync(userFile, "utf8");

let dimensionId = null;
try {
  dimensionId = JSON.parse(user).dimension_id ?? null;
} catch {
  // A user message that is not JSON names no dimension.
}
const key = keyTemplate.replace("{id}", dimensionId ?? "unknown");

if (captureDir !== "-") {
  fs.mkdirSync(captureDir, { recursive: true });
  fs.writeFileSync(path.join(captureDir, `${key}.system.txt`), system);
  fs.writeFileSync(path.join(captureDir, `${key}.user.txt`), user);
}

const answers = JSON.parse(fs.readFileSync(answersFile, "utf8"));
if (!(key in answers)) {
  process.stderr.write(`eval-snapshot-stub: no answer for "${key}"\n`);
  process.exit(1);
}
process.stdout.write(JSON.stringify({ result: JSON.stringify(answers[key]) }));
