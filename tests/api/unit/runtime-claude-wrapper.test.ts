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

/** Replies with an envelope whose `result` is free text left unclosed, and, when asked for a schema, a structured answer. */
const STAND_IN_CLAUDE = `#!/usr/bin/env bash
node -e '
  const fs = require("fs");
  const args = process.argv.slice(1);
  fs.writeFileSync(process.env.STAND_IN_ARGS, JSON.stringify(args));
  const envelope = { result: "{\\"verdict\\":\\"pass\\",\\"reasoning\\":\\"unclosed}", total_cost_usd: 0.01 };
  if (args.includes("--json-schema")) envelope.structured_output = { verdict: "pass", reasoning: "closed" };
  process.stdout.write(JSON.stringify(envelope));
' -- "$@"
`;

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function runWrapper(schema: Record<string, unknown> | null) {
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
  const run = spawnSync("bash", [WRAPPER, system, user], { encoding: "utf8", env });
  return { ...run, args: JSON.parse(await fs.readFile(argsFile, "utf8")) as string[] };
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

  it("passes no schema and leaves the reply as written without one, as for the narrator", async () => {
    const run = await runWrapper(null);
    expect(run.status, run.stderr).toBe(0);
    expect(run.args).not.toContain("--json-schema");
    expect(JSON.parse(run.stdout).result).toBe('{"verdict":"pass","reasoning":"unclosed}');
  });
});
