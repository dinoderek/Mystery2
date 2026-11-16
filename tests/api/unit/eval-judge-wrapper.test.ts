/**
 * The blueprint judge's wrapper launches the Claude CLI lean: only the tools
 * its workspace protocol uses, none of the login's settings, plugins, skills
 * or MCP servers, at medium effort. A stand-in `claude` records its arguments
 * and writes the verdict the way the agent does; no model is called.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";

const WRAPPER = path.join(repoRoot(), "evaluation/config/wrappers/claude-judge.sh");
const VERDICT = { verdict: "pass" };

const STAND_IN_CLAUDE = `#!/usr/bin/env bash
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' "$EVAL_ARGS_FILE" "$@"
printf '%s' '${JSON.stringify(VERDICT)}' > verdict.json
`;

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function runWrapper(): Promise<{ status: number | null; stdout: string; stderr: string; args: string[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "judge-wrapper-"));
  tmpDirs.push(dir);
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(binDir, "claude"), STAND_IN_CLAUDE, { mode: 0o755 });
  const userMessage = path.join(dir, "user-message.json");
  await fs.writeFile(userMessage, JSON.stringify({ dimension_id: "fairness", context: {}, story_brief: {}, blueprint: {} }));
  const argsFile = path.join(dir, "args.json");
  const result = spawnSync("bash", [WRAPPER, "", userMessage], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      EVAL_MODEL: "stand-in-model",
      EVAL_DIMENSION_ID: "fairness",
      EVAL_RUN_DIR: path.join(dir, "run"),
      EVAL_STREAM_FILE: path.join(dir, "run", "logs", "judge.stream.jsonl"),
      EVAL_ARGS_FILE: argsFile,
    },
  });
  const args = JSON.parse(await fs.readFile(argsFile, "utf8").catch(() => "[]")) as string[];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, args };
}

function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

describe("the blueprint judge wrapper", () => {
  it("launches the agent lean, on the binding's model at medium effort, and returns its verdict", async () => {
    const run = await runWrapper();
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ result: `${JSON.stringify(VERDICT, null, 2)}\n` });
    expect(valueOf(run.args, "--model")).toBe("stand-in-model");
    expect(valueOf(run.args, "--effort")).toBe("medium");
    expect(valueOf(run.args, "--tools")).toBe("Read,Write,Edit,Bash");
    expect(valueOf(run.args, "--setting-sources")).toBe("");
    for (const flag of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) expect(run.args, flag).toContain(flag);
  });
});
