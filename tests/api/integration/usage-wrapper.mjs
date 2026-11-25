// A stand-in wrapper that runs a stub "model" and reports the token usage the
// Claude CLI reports, so a run on stub bindings records tokens as a run on a
// real model does. No model is called.
//
// Usage (as a binding's cmd and args):
//   node usage-wrapper.mjs wrap <cmd> [args...]   the stub prints the answer;
//       this prints the Claude CLI's envelope around it: {"result", "total_cost_usd", "usage"}
//       (the binding's extract_path is "result")
//   node usage-wrapper.mjs add <cmd> [args...]    the stub prints an envelope of
//       its own; this prints it with "usage" added, and a cost if it has none
//
// The stub gets this process's environment and its exit code is passed on.

import { spawnSync } from "node:child_process";
import process from "node:process";

/** The counts every call reports: input, output, cache read and cache write. */
const USAGE = { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 };
const COST_USD = 0.002;

const [mode, cmd, ...args] = process.argv.slice(2);
if (mode !== "wrap" && mode !== "add") {
  process.stderr.write(`usage-wrapper: the mode is wrap or add, got ${mode}\n`);
  process.exit(2);
}

const ran = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (ran.status !== 0) {
  process.stderr.write(`usage-wrapper: ${cmd} exited ${ran.status ?? ran.signal}\n`);
  process.exit(ran.status ?? 1);
}

const envelope = mode === "wrap" ? { result: ran.stdout, total_cost_usd: COST_USD } : JSON.parse(ran.stdout);
process.stdout.write(JSON.stringify({ total_cost_usd: COST_USD, ...envelope, usage: USAGE }));
