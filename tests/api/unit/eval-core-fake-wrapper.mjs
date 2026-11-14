// A fake model wrapper for the evaluation core's runner tests. It plays one
// step of FAKE_WRAPPER_STEPS (comma-separated) per attempt, counting attempts in
// the file FAKE_WRAPPER_COUNTER, and records what it was given in
// FAKE_WRAPPER_RECORD so a test can check the prompt files and environment.
//
// Steps:
//   ok        prints {"result": "{\"answer\":42}", "total_cost_usd": 0.25}
//   nocost    prints {"result": "{\"answer\":42}"}
//   bare      prints {"answer":42} (for extract_path null)
//   text      prints plain text
//   invalid   prints {"result": "{\"answer\":\"no\"}", "total_cost_usd": 0.1}
//   exit      writes to stderr and exits 3
//   not_json  prints something that is not JSON
//   no_path   prints JSON without the extract path
//   hang      starts a child that holds stdout open, then waits forever; with
//             FAKE_WRAPPER_PIDS set, writes its own and the child's pid there
//   stream    writes two events to EVAL_STREAM_FILE, then behaves as ok
//   streamed_cost  writes a result event with a cost to EVAL_STREAM_FILE and
//             prints an envelope without one, as the stream-json wrappers do

import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { setTimeout } from "node:timers";

const [systemFile, userFile] = process.argv.slice(2);
const counter = process.env.FAKE_WRAPPER_COUNTER;
const attempt = counter && fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;
if (counter) fs.writeFileSync(counter, String(attempt));

const steps = (process.env.FAKE_WRAPPER_STEPS ?? "ok").split(",");
const step = steps[Math.min(attempt, steps.length) - 1];

if (process.env.FAKE_WRAPPER_RECORD) {
  fs.appendFileSync(
    process.env.FAKE_WRAPPER_RECORD,
    `${JSON.stringify({
      attempt,
      system: systemFile ? fs.readFileSync(systemFile, "utf8") : null,
      user: userFile ? fs.readFileSync(userFile, "utf8") : null,
      model: process.env.EVAL_MODEL ?? null,
      stream: process.env.EVAL_STREAM_FILE ?? null,
      extra: process.env.FAKE_EXTRA ?? null,
    })}\n`,
  );
}

const answer = (value) => JSON.stringify({ answer: value });

switch (step) {
  case "ok":
    process.stdout.write(JSON.stringify({ result: answer(42), total_cost_usd: 0.25 }));
    break;
  case "nocost":
    process.stdout.write(JSON.stringify({ result: answer(42) }));
    break;
  case "bare":
    process.stdout.write(answer(42));
    break;
  case "text":
    process.stdout.write("  plain narration  \n");
    break;
  case "invalid":
    process.stdout.write(JSON.stringify({ result: answer("no"), total_cost_usd: 0.1 }));
    break;
  case "exit":
    process.stderr.write("fake wrapper failed\n");
    process.exit(3);
    break;
  case "not_json":
    process.stdout.write("this is not json");
    break;
  case "no_path":
    process.stdout.write(JSON.stringify({ other: 1 }));
    break;
  case "hang":
    {
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      if (process.env.FAKE_WRAPPER_PIDS) {
        fs.writeFileSync(process.env.FAKE_WRAPPER_PIDS, JSON.stringify([process.pid, child.pid]));
      }
      setTimeout(() => {}, 60_000);
    }
    break;
  case "stream":
    fs.appendFileSync(
      process.env.EVAL_STREAM_FILE,
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking aloud" }] } })}\n` +
        `${JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens_delta: 1500 })}\n`,
    );
    process.stdout.write(JSON.stringify({ result: answer(42), total_cost_usd: 0.25 }));
    break;
  case "streamed_cost":
    fs.appendFileSync(
      process.env.EVAL_STREAM_FILE,
      `${JSON.stringify({ type: "result", num_turns: 2, total_cost_usd: 1.5 })}\n{"type":`,
    );
    process.stdout.write(JSON.stringify({ result: answer(42) }));
    break;
  default:
    process.stderr.write(`unknown step ${step}\n`);
    process.exit(9);
}
