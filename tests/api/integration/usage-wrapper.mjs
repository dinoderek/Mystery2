// A stand-in wrapper that answers as a stub "model" and reports the token usage
// the Claude CLI reports, so a run on stub bindings records tokens as a run on a
// real model does. No model is called.
//
// Usage (as a binding's cmd and args; extract_path "result" for the first two):
//   node usage-wrapper.mjs <tokens> narrate <user file>   answers as the stub
//       narrator, evaluation/runtime/config/wrappers/stub-runtime.sh, does
//   node usage-wrapper.mjs <tokens> pass <user file>      answers as the stub turn
//       judge, evaluation/runtime/config/wrappers/stub-judge.sh, does: nothing wrong
//   node usage-wrapper.mjs <tokens> add <cmd> [args...]   runs a stub that prints
//       the Claude CLI's JSON envelope, and prints it with "usage" added, and a
//       cost if it has none; the stub's exit code is passed on
//
// <tokens> is the JSON {input, output, cache_read, cache_write} every call
// reports, as the CLI's `usage` counts.
//
// The narrator and turn judge answer in this process rather than through their
// shell stubs: a narration suite makes hundreds of calls, and each spawn counts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const COST_USD = 0.002;
const LOOK = "You take a slow look around. Nothing new catches your eye just yet.";

/** The stub narrator's reply: role JSON for a role-output prompt (a JSON payload), else plain narration. */
function narrate(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return LOOK;
  }
  const role = payload.context?.role_name ?? "";
  return JSON.stringify({
    narration: role.startsWith("talk") ? '"Of course," comes the friendly reply. "Ask me whatever you like."' : LOOK,
    revealed_clue_ids: [],
    input_understood: true,
    ...(role.startsWith("graph_") ? { opened: [], answered: [], notebook: [] } : {}),
  });
}

function envelope(mode, args) {
  if (mode === "narrate") return { result: narrate(fs.readFileSync(args[0], "utf8")) };
  if (mode === "pass") {
    JSON.parse(fs.readFileSync(args[0], "utf8"));
    return { result: JSON.stringify({ estimated_reading_age: 8, findings: [], verdict: "pass", reasoning: "Stub verdict: nothing to report." }) };
  }
  if (mode === "add") {
    const [cmd, ...rest] = args;
    const ran = spawnSync(cmd, rest, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    if (ran.status !== 0) {
      process.stderr.write(`usage-wrapper: ${cmd} exited ${ran.status ?? ran.signal}\n`);
      process.exit(ran.status ?? 1);
    }
    return JSON.parse(ran.stdout);
  }
  process.stderr.write(`usage-wrapper: the mode is narrate, pass or add, got ${mode}\n`);
  process.exit(2);
}

const [tokens, mode, ...args] = process.argv.slice(2);
const { input, output, cache_read, cache_write } = JSON.parse(tokens);
const usage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: cache_read, cache_creation_input_tokens: cache_write };
process.stdout.write(JSON.stringify({ total_cost_usd: COST_USD, ...envelope(mode, args), usage }));
