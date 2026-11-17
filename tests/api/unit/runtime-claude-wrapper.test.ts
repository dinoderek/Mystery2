/**
 * The runtime harness's Claude wrapper, which backs the turn judges and the
 * narrator. Given a schema file, it holds the CLI's answer to it and returns
 * the checked structured answer as `result`; without one it returns the CLI's
 * envelope as it is. A stand-in `claude` records its arguments; no model is called.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";

const WRAPPER = path.join(repoRoot(), "evaluation/runtime/config/wrappers/claude-runtime.sh");

/**
 * Replies with an envelope whose `result` is free text left unclosed, and, when
 * asked for a schema, a structured answer: STAND_IN_REASONING's text, written
 * in two parts, apart in time, that split its first multibyte character.
 * STAND_IN_MODE `exit` fails as the CLI does; `prose` prints no JSON.
 */
const STAND_IN_CLAUDE = `#!/usr/bin/env bash
node -e '
  const fs = require("fs");
  const args = process.argv.slice(1);
  fs.writeFileSync(process.env.STAND_IN_ARGS, JSON.stringify(args));
  if (process.env.STAND_IN_MODE === "exit") { process.stderr.write("cli failed"); process.exit(3); }
  if (process.env.STAND_IN_MODE === "prose") { process.stdout.write("not json"); process.exit(0); }
  const envelope = { result: "{\\"verdict\\":\\"pass\\",\\"reasoning\\":\\"unclosed}", total_cost_usd: 0.01 };
  if (args.includes("--json-schema")) envelope.structured_output = { verdict: "pass", reasoning: process.env.STAND_IN_REASONING ?? "closed" };
  const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
  const cut = bytes.findIndex((byte) => byte >= 0x80) + 1 || bytes.length;
  fs.writeSync(1, bytes.subarray(0, cut));
  setTimeout(() => fs.writeSync(1, bytes.subarray(cut)), 200);
' -- "$@"
`;

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function runWrapper(schema: Record<string, unknown> | null, standIn: Record<string, string> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-wrapper-"));
  tmpDirs.push(dir);
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(binDir, "claude"), STAND_IN_CLAUDE, { mode: 0o755 });
  const system = path.join(dir, "system.txt");
  const user = path.join(dir, "user.txt");
  await fs.writeFile(system, "SYSTEM");
  await fs.writeFile(user, "USER");
  const schemaFile = path.join(dir, "schema.json");
  if (schema) await fs.writeFile(schemaFile, JSON.stringify(schema));
  const argsFile = path.join(dir, "args.json");
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`, EVAL_MODEL: "stand-in", STAND_IN_ARGS: argsFile };
  if (schema) env.EVAL_JSON_SCHEMA_FILE = schemaFile;
  else delete env.EVAL_JSON_SCHEMA_FILE;
  Object.assign(env, standIn);
  const run = spawnSync("bash", [WRAPPER, system, user], { encoding: "utf8", env });
  return { ...run, args: JSON.parse(await fs.readFile(argsFile, "utf8").catch(() => "[]")) as string[] };
}

describe("the runtime Claude wrapper", () => {
  it("holds the answer to the schema it is given and returns the structured answer as the result", async () => {
    const schema = { type: "object", required: ["verdict"], properties: { verdict: { type: "string" } } };
    const run = await runWrapper(schema);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.args[run.args.indexOf("--json-schema") + 1])).toEqual(schema);
    expect(run.args.slice(run.args.indexOf("--model"), run.args.indexOf("--model") + 2)).toEqual(["--model", "stand-in"]);
    const envelope = JSON.parse(run.stdout);
    expect(JSON.parse(envelope.result)).toEqual({ verdict: "pass", reasoning: "closed" });
    expect(envelope.total_cost_usd).toBe(0.01);
  });

  it("keeps a multibyte character whole however the CLI's output is read", async () => {
    const reasoning = "Mara’s “alibi” — café, naïve, 🦊";
    const run = await runWrapper({ type: "object" }, { STAND_IN_REASONING: reasoning });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(JSON.parse(run.stdout).result).reasoning).toBe(reasoning);
  });

  it("fails as the CLI fails, passes on output that is not JSON as it is, and refuses a schema file it cannot read", async () => {
    const schema = { type: "object" };
    const failed = await runWrapper(schema, { STAND_IN_MODE: "exit" });
    expect(failed.status).toBe(3);
    expect(failed.stderr).toContain("cli failed");
    expect((await runWrapper(schema, { STAND_IN_MODE: "prose" })).stdout).toBe("not json");
    const missing = await runWrapper(null, { EVAL_JSON_SCHEMA_FILE: "/nonexistent/schema.json" });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("no schema at /nonexistent/schema.json");
  });

  it("passes no schema and leaves the reply as written without one, as for the narrator", async () => {
    const run = await runWrapper(null);
    expect(run.status, run.stderr).toBe(0);
    expect(run.args).not.toContain("--json-schema");
    expect(JSON.parse(run.stdout).result).toBe('{"verdict":"pass","reasoning":"unclosed}');
  });
});
