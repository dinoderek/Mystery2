#!/usr/bin/env node
// A stand-in for the `claude` CLI, for the claude-cli provider's unit tests.
//
// It records what it was called with and answers the way the real CLI does
// with `--output-format json`. FAKE_CLAUDE_BEHAVIOUR picks the answer:
//
//   ok           a successful reply: `structured_output` from FAKE_CLAUDE_OUTPUT
//                (JSON) when --json-schema was passed, else a narration `result`
//   is-error     a reply flagged is_error, exit code 1
//   crash        nothing on stdout, exit code 2
//   not-json     text that is not JSON, exit code 0
//   no-output    a successful reply with no structured_output
//   hang         never answers (the provider's timeout kills it)
//   fail-once    crash on the first call, then behave like ok
//
// FAKE_CLAUDE_RECORD names a file each call appends one JSON line to:
// { args, stdin, cwd }. FAKE_CLAUDE_COUNTER is a scratch file for fail-once.

import fs from "node:fs";
import process from "node:process";
import { setInterval } from "node:timers";

const behaviour = process.env.FAKE_CLAUDE_BEHAVIOUR ?? "ok";
const args = process.argv.slice(2);

const stdin = fs.readFileSync(0, "utf8");
if (process.env.FAKE_CLAUDE_RECORD) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    `${JSON.stringify({ args, stdin, cwd: process.cwd() })}\n`,
  );
}

function reply(fields) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 5,
        output_tokens: 42,
      },
      modelUsage: {
        "claude-haiku-helper": { inputTokens: 100, outputTokens: 1 },
        "claude-sonnet-test-1": {
          inputTokens: 10,
          cacheCreationInputTokens: 1000,
          cacheReadInputTokens: 5,
          outputTokens: 42,
        },
      },
      ...fields,
    }),
  );
}

function succeed() {
  if (args.includes("--json-schema")) {
    const output = JSON.parse(process.env.FAKE_CLAUDE_OUTPUT ?? '{"narration":"Hi."}');
    reply({ result: JSON.stringify(output), structured_output: output });
  } else {
    reply({ result: "  The fake narrator speaks.  " });
  }
}

switch (behaviour) {
  case "ok":
    succeed();
    break;
  case "is-error":
    reply({ is_error: true, subtype: "error_during_execution", result: "Not logged in" });
    process.exit(1);
    break;
  case "crash":
    process.stderr.write("fake claude crashed\n");
    process.exit(2);
    break;
  case "not-json":
    process.stdout.write("this is not json");
    break;
  case "no-output":
    reply({ result: "" });
    break;
  case "hang":
    setInterval(() => {}, 1000);
    break;
  case "fail-once": {
    const counter = process.env.FAKE_CLAUDE_COUNTER;
    const calls = counter && fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
    if (counter) fs.writeFileSync(counter, String(calls + 1));
    if (calls === 0) {
      process.stderr.write("fake claude failed once\n");
      process.exit(2);
    }
    succeed();
    break;
  }
  default:
    process.stderr.write(`unknown FAKE_CLAUDE_BEHAVIOUR ${behaviour}\n`);
    process.exit(3);
}
