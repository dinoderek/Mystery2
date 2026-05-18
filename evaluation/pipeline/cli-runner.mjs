import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Render args with file-path placeholders.
//
// Supported placeholders:
//   {{system_prompt_file}} — path to a temp file holding the system prompt
//   {{user_message_file}}  — path to a temp file holding the user message
//
// The runner writes both temp files, substitutes paths, spawns cmd with the
// rendered args. stdin is closed. stdout is captured. timeout is enforced.
//
// On success the runner parses stdout as JSON. If extract_path is provided
// (dotted, e.g. "result"), it walks into the parsed object before returning.
// The extracted value is returned as a string for the caller to parse
// further (typically as JSON again for structured model responses).

export async function runCli({
  step,
  config,
  systemPrompt,
  userMessage,
  logDir,
}) {
  if (!config || !config.cmd) {
    throw new Error(`CLI config for step "${step}" missing cmd`);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `mystery-eval-${step}-`));
  const systemPromptFile = path.join(tmp, "system.txt");
  const userMessageFile = path.join(tmp, "user.txt");

  await fs.writeFile(systemPromptFile, systemPrompt, "utf8");
  await fs.writeFile(userMessageFile, userMessage, "utf8");

  const replacements = {
    "{{system_prompt_file}}": systemPromptFile,
    "{{user_message_file}}": userMessageFile,
  };

  const args = (config.args ?? []).map((arg) =>
    Object.entries(replacements).reduce(
      (acc, [token, value]) => acc.replaceAll(token, value),
      String(arg),
    ),
  );

  const stdoutChunks = [];
  const stderrChunks = [];
  const startedAt = Date.now();

  let exitCode = null;
  let timedOut = false;

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(config.cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, config.timeout_ms ?? 120000);

      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        exitCode = code;
        resolve();
      });
    });
  } finally {
    if (logDir) {
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(
        path.join(logDir, `${step}.stdout.log`),
        Buffer.concat(stdoutChunks),
      );
      await fs.writeFile(
        path.join(logDir, `${step}.stderr.log`),
        Buffer.concat(stderrChunks),
      );
      await fs.writeFile(
        path.join(logDir, `${step}.invocation.json`),
        JSON.stringify(
          {
            step,
            cmd: config.cmd,
            args,
            exit_code: exitCode,
            timed_out: timedOut,
            duration_ms: Date.now() - startedAt,
            system_prompt_file: systemPromptFile,
            user_message_file: userMessageFile,
          },
          null,
          2,
        ),
      );
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }

  if (timedOut) {
    throw new Error(`CLI step "${step}" timed out after ${config.timeout_ms ?? 120000}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `CLI step "${step}" exited with code ${exitCode}. stderr: ${
        Buffer.concat(stderrChunks).toString("utf8").slice(0, 1000)
      }`,
    );
  }

  const stdoutText = Buffer.concat(stdoutChunks).toString("utf8").trim();

  let parsed;
  try {
    parsed = JSON.parse(stdoutText);
  } catch {
    throw new Error(
      `CLI step "${step}" stdout is not valid JSON. First 500 chars: ${stdoutText.slice(0, 500)}`,
    );
  }

  if (!config.extract_path) {
    return { extracted: stdoutText, raw: parsed };
  }

  const parts = config.extract_path.split(".").filter(Boolean);
  let cursor = parsed;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in cursor) {
      cursor = cursor[part];
    } else {
      throw new Error(
        `CLI step "${step}": extract_path "${config.extract_path}" not found in stdout JSON.`,
      );
    }
  }
  if (typeof cursor !== "string") {
    throw new Error(
      `CLI step "${step}": extract_path "${config.extract_path}" resolved to non-string value.`,
    );
  }
  return { extracted: cursor, raw: parsed };
}

// Wraps runCli with a retry loop. Always returns a result object — does not
// throw. On the final failure, returns { ok: false, error, attempts }.
// Each attempt invokes runCli with a per-attempt step name when retries > 0
// so each attempt gets its own stdout/stderr/invocation log files.
export async function runCliWithRetries({
  step,
  config,
  systemPrompt,
  userMessage,
  logDir,
  retries = 0,
}) {
  const max = 1 + Math.max(0, Number.isInteger(retries) ? retries : 0);
  const attempts = [];
  for (let i = 1; i <= max; i += 1) {
    const startedAt = Date.now();
    const attemptStep = max === 1 ? step : `${step}.attempt-${i}`;
    try {
      const result = await runCli({
        step: attemptStep,
        config,
        systemPrompt,
        userMessage,
        logDir,
      });
      attempts.push({
        attempt: i,
        outcome: "ok",
        duration_ms: Date.now() - startedAt,
      });
      return { ok: true, ...result, attempts };
    } catch (err) {
      attempts.push({
        attempt: i,
        outcome: "cli_fail",
        duration_ms: Date.now() - startedAt,
        error: String(err.message ?? err).slice(0, 500),
      });
      if (i === max) {
        return {
          ok: false,
          error: { message: String(err.message ?? err) },
          attempts,
        };
      }
    }
  }
  // Unreachable; the loop always returns.
  return { ok: false, error: { message: "runCliWithRetries fell through" }, attempts };
}
