// File-bus wrapper for the evaluation pipeline.
//
// Invoked instead of an external LLM CLI when the pipeline runs inside an
// environment that has no CLI access but does have a supervising assistant
// that can dispatch subagents (e.g. Claude Code on the web). The pipeline
// spawns this wrapper as if it were a CLI; the wrapper drops a request on
// disk and blocks until a response file appears, then prints the response
// to stdout in the shape the pipeline expects.
//
// Argv (after `node file-bus.mjs`):
//   [0] step          — "generate" or "judge" (informational; included in the
//                        request file and in the inbox dirname)
//   [1] timeout_ms    — pipeline-side timeout for this step. The wrapper
//                        exits with margin before this to give the pipeline a
//                        usable stderr on timeout.
//   [2] system_prompt_file — path to a temp file holding the system prompt
//                            (deleted by the pipeline after this wrapper exits)
//   [3] user_message_file  — path to a temp file holding the user message
//
// Contract with the dispatcher (the supervising assistant):
//   Inbox:  evaluation/agent-bus/inbox/<id>/
//             ├── system.txt
//             ├── user.txt
//             └── request.json   { id, step, system_path, user_path,
//                                  created_at, deadline_at }
//   Outbox: evaluation/agent-bus/outbox/<id>.json        → { result: "..." }
//           evaluation/agent-bus/outbox/<id>.error.json  → { error: "..." }
//
// Contract with the pipeline:
//   stdout on success — JSON `{"result": "<text>"}` (matches
//                       extract_path: "result" in cli.json)
//   non-zero exit on failure (pipeline retries per cli.json `retries`).

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MARGIN_MS = 15000;

function usage() {
  process.stderr.write(
    "Usage: node file-bus.mjs <step> <timeout_ms> <system_prompt_file> <user_message_file>\n",
  );
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`file-bus: ${message}\n`);
  process.exit(1);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

const [stepArg, timeoutArg, systemFileArg, userFileArg] = process.argv.slice(2);
if (!stepArg || !timeoutArg || !systemFileArg || !userFileArg) usage();

const step = stepArg;
const pipelineTimeoutMs = Number.parseInt(timeoutArg, 10);
if (!Number.isFinite(pipelineTimeoutMs) || pipelineTimeoutMs <= 0) {
  fail(`invalid timeout_ms: ${timeoutArg}`);
}
const wrapperTimeoutMs = Math.max(
  pipelineTimeoutMs - TIMEOUT_MARGIN_MS,
  Math.floor(pipelineTimeoutMs * 0.5),
);

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, "..", "..");
const inboxRoot = path.join(evalRoot, "agent-bus", "inbox");
const outboxRoot = path.join(evalRoot, "agent-bus", "outbox");

const id = `${step}-${timestamp()}-${randomUUID().slice(0, 8)}`;
const inboxDir = path.join(inboxRoot, id);
const outboxOk = path.join(outboxRoot, `${id}.json`);
const outboxErr = path.join(outboxRoot, `${id}.error.json`);

async function cleanup() {
  await Promise.allSettled([
    fs.rm(inboxDir, { recursive: true, force: true }),
    fs.rm(outboxOk, { force: true }),
    fs.rm(outboxErr, { force: true }),
  ]);
}

async function readIfExists(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.mkdir(outboxRoot, { recursive: true });

  const [systemPrompt, userMessage] = await Promise.all([
    fs.readFile(systemFileArg, "utf8"),
    fs.readFile(userFileArg, "utf8"),
  ]);

  const systemPath = path.join(inboxDir, "system.txt");
  const userPath = path.join(inboxDir, "user.txt");
  await Promise.all([
    fs.writeFile(systemPath, systemPrompt, "utf8"),
    fs.writeFile(userPath, userMessage, "utf8"),
  ]);

  const createdAt = new Date();
  const deadlineAt = new Date(createdAt.getTime() + wrapperTimeoutMs);
  const request = {
    id,
    step,
    system_path: path.relative(evalRoot, systemPath),
    user_path: path.relative(evalRoot, userPath),
    created_at: createdAt.toISOString(),
    deadline_at: deadlineAt.toISOString(),
    pipeline_timeout_ms: pipelineTimeoutMs,
  };
  await fs.writeFile(
    path.join(inboxDir, "request.json"),
    JSON.stringify(request, null, 2),
    "utf8",
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < wrapperTimeoutMs) {
    const errText = await readIfExists(outboxErr);
    if (errText !== null) {
      let parsed;
      try {
        parsed = JSON.parse(errText);
      } catch {
        await cleanup();
        fail(`dispatcher wrote unparseable error file for ${id}`);
      }
      await cleanup();
      fail(`dispatcher error: ${parsed.error ?? "(no message)"}`);
    }

    const okText = await readIfExists(outboxOk);
    if (okText !== null) {
      let parsed;
      try {
        parsed = JSON.parse(okText);
      } catch {
        await cleanup();
        fail(`dispatcher wrote unparseable response for ${id}`);
      }
      if (typeof parsed.result !== "string") {
        await cleanup();
        fail(`dispatcher response for ${id} missing string "result" field`);
      }
      process.stdout.write(JSON.stringify({ result: parsed.result }));
      await cleanup();
      process.exit(0);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await cleanup();
  fail(
    `timed out after ${wrapperTimeoutMs}ms waiting for dispatcher response (id=${id}). ` +
      `Pipeline timeout is ${pipelineTimeoutMs}ms; wrapper exits ${TIMEOUT_MARGIN_MS}ms early to surface stderr.`,
  );
}

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

main().catch(async (err) => {
  await cleanup();
  fail(String(err.message ?? err));
});
