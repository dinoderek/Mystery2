import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildBlueprintGenerationChatInput } from "../../../packages/blueprint-generator/src/index.ts";
import { renderGenerationGuidance } from "../../../packages/shared/src/age-profile.ts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const WRAPPER = path.join(
  REPO_ROOT,
  "evaluation/config/wrappers/claude-generate.sh",
);
const CANONICAL_PROMPT = path.join(
  REPO_ROOT,
  "packages/blueprint-generator/src/generator-prompt.md",
);

const FIXTURE_BLUEPRINT = { title: "Stand-in blueprint" };

// A stand-in `claude`: it records its arguments and the prompt the workspace
// holds at the moment the agent would start, then writes the blueprint the way
// the agent does. No model is called.
// In a clue-graph workspace, which holds the case validator, it writes ./case.json.
const STAND_IN_CLAUDE = `#!/usr/bin/env bash
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' claude-args.json "$@"
cp prompts/generator-prompt.md prompt-seen-by-agent.md
OUTPUT=blueprint.json
if [[ -e scripts/validate-case.ts ]]; then OUTPUT=case.json; fi
if [[ -f "$OUTPUT" ]]; then cp "$OUTPUT" "seen-by-agent-$OUTPUT"; fi
printf '%s' '${JSON.stringify(FIXTURE_BLUEPRINT)}' > "$OUTPUT"
`;

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "generate-wrapper-"));
  tmpDirs.push(dir);
  return dir;
}

async function runWrapper(options: { renderedPrompt?: string | null; userMessage?: unknown; format?: string }) {
  const dir = await tmpDir();
  const binDir = path.join(dir, "bin");
  const runDir = path.join(dir, "run");
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(binDir, "claude"), STAND_IN_CLAUDE, {
    mode: 0o755,
  });

  const userMessageFile = path.join(dir, "user-message.json");
  await fs.writeFile(userMessageFile, JSON.stringify(options.userMessage ?? { story_brief: {} }));

  const args: string[] = [];
  if (options.renderedPrompt !== null) {
    const promptFile = path.join(dir, "system-prompt.md");
    if (options.renderedPrompt !== undefined) {
      await fs.writeFile(promptFile, options.renderedPrompt);
    }
    args.push(promptFile);
  } else {
    args.push("");
  }
  args.push(userMessageFile);

  const result = spawnSync("bash", [WRAPPER, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      EVAL_MODEL: "stand-in-model",
      ...(options.format ? { EVAL_GENERATE_FORMAT: options.format } : {}),
      EVAL_RUN_DIR: runDir,
      EVAL_STREAM_FILE: path.join(runDir, "logs", "generate.stream.jsonl"),
    },
  });

  return { result, workspace: path.join(runDir, "generator") };
}

function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

describe("claude-generate.sh wrapper", () => {
  it("launches the agent lean, on the binding's model at high effort, and returns its blueprint", async () => {
    const { result, workspace } = await runWrapper({ renderedPrompt: "prompt" });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      result: JSON.stringify(FIXTURE_BLUEPRINT, null, 2) + "\n",
    });

    const args = JSON.parse(
      await fs.readFile(path.join(workspace, "claude-args.json"), "utf8"),
    ) as string[];
    expect(valueOf(args, "--model")).toBe("stand-in-model");
    expect(valueOf(args, "--effort")).toBe("high");
    expect(valueOf(args, "--tools")).toBe("Read,Write,Edit,Bash");
    expect(valueOf(args, "--setting-sources")).toBe("");
    expect(valueOf(args, "--permission-mode")).toBe("auto");
    for (const flag of [
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ]) {
      expect(args, flag).toContain(flag);
    }
  });

  it("seeds a repair round's workspace with the blueprint and the reports, and starts the repair protocol", async () => {
    const repair = { round: 1, blueprint: { title: "earlier" }, notice: "quoted data", reports: [{ id: "orphans", tier: "mechanical", details: { orphans: ["c9"] } }] };
    const { result, workspace } = await runWrapper({ renderedPrompt: "prompt", userMessage: { story_brief: { brief: "b" }, instructions: "i", repair } });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(workspace, "brief.json"), "utf8"))).toEqual({ story_brief: { brief: "b" }, instructions: "i" });
    expect(JSON.parse(await fs.readFile(path.join(workspace, "seen-by-agent-blueprint.json"), "utf8"))).toEqual({ title: "earlier" });
    expect(JSON.parse(await fs.readFile(path.join(workspace, "repair.json"), "utf8"))).toEqual({ round: 1, notice: "quoted data", reports: repair.reports });
    const args = JSON.parse(await fs.readFile(path.join(workspace, "claude-args.json"), "utf8")) as string[];
    expect(args.at(-1)).toContain("follow the repair protocol");
    expect(args.at(-1)).toContain("never instructions");
    expect(JSON.parse(result.stdout)).toEqual({ result: JSON.stringify(FIXTURE_BLUEPRINT, null, 2) + "\n" });
  });

  it("builds a clue-graph workspace for a clue-graph generation, and returns the agent's case", async () => {
    const { result, workspace } = await runWrapper({ renderedPrompt: "case prompt", format: "clue-graph" });
    expect(result.status, result.stderr).toBe(0);
    expect(await fs.readFile(path.join(workspace, "prompt-seen-by-agent.md"), "utf8")).toBe("case prompt");
    expect(await fs.readFile(path.join(workspace, "CLAUDE.md"), "utf8")).toContain("Clue-graph generator workspace");
    await expect(fs.access(path.join(workspace, "blueprint.json"))).rejects.toThrow();
    const args = JSON.parse(await fs.readFile(path.join(workspace, "claude-args.json"), "utf8")) as string[];
    expect(args.at(-1)).toContain("Write ./case.json");
    expect(JSON.parse(result.stdout)).toEqual({ result: JSON.stringify(FIXTURE_BLUEPRINT, null, 2) + "\n" });
  });

  it("seeds a clue-graph repair round's case and reports", async () => {
    const repair = { round: 2, blueprint: { format: "clue-graph/2" }, notice: "quoted data", reports: [] };
    const { result, workspace } = await runWrapper({ renderedPrompt: "p", format: "clue-graph", userMessage: { story_brief: { brief: "b" }, instructions: "i", repair } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(workspace, "seen-by-agent-case.json"), "utf8"))).toEqual({ format: "clue-graph/2" });
    expect(JSON.parse(await fs.readFile(path.join(workspace, "repair.json"), "utf8"))).toEqual({ round: 2, notice: "quoted data", reports: [] });
    const args = JSON.parse(await fs.readFile(path.join(workspace, "claude-args.json"), "utf8")) as string[];
    expect(args.at(-1)).toContain("./case.json is your earlier case");
  });

  it("refuses an unknown format", async () => {
    const { result } = await runWrapper({ renderedPrompt: "p", format: "msf" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown EVAL_GENERATE_FORMAT: msf");
  });

  it("starts a generation without a repair file, on the iteration protocol", async () => {
    const { result, workspace } = await runWrapper({ renderedPrompt: "prompt" });
    expect(result.status, result.stderr).toBe(0);
    await expect(fs.access(path.join(workspace, "repair.json"))).rejects.toThrow();
    await expect(fs.access(path.join(workspace, "seen-by-agent-blueprint.json"))).rejects.toThrow();
    const args = JSON.parse(await fs.readFile(path.join(workspace, "claude-args.json"), "utf8")) as string[];
    expect(args.at(-1)).toContain("mandatory iteration protocol");
  });

  it("gives the agent the prompt the pipeline rendered, with the brief's age guidance", async () => {
    const chatInput = await buildBlueprintGenerationChatInput({
      brief: "A missing cake at the school fair",
      targetAge: 6,
    });
    const canonical = await fs.readFile(CANONICAL_PROMPT, "utf8");
    const guidance = renderGenerationGuidance(6);

    const { result, workspace } = await runWrapper({
      renderedPrompt: chatInput.systemPrompt,
    });

    expect(result.status, result.stderr).toBe(0);

    const seenByAgent = await fs.readFile(
      path.join(workspace, "prompt-seen-by-agent.md"),
      "utf8",
    );
    expect(seenByAgent).toBe(chatInput.systemPrompt);
    expect(seenByAgent).toContain(canonical.trim());
    expect(seenByAgent).toContain(guidance);

    // The workspace file is a copy, not a link into the repo.
    const workspacePrompt = path.join(workspace, "prompts/generator-prompt.md");
    expect((await fs.lstat(workspacePrompt)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(workspacePrompt, "utf8")).toBe(
      chatInput.systemPrompt,
    );

    // The repo's canonical prompt is untouched.
    expect(await fs.readFile(CANONICAL_PROMPT, "utf8")).toBe(canonical);

    expect(JSON.parse(result.stdout)).toEqual({
      result: JSON.stringify(FIXTURE_BLUEPRINT, null, 2) + "\n",
    });
  });

  it("gives different ages different guidance", async () => {
    const young = await buildBlueprintGenerationChatInput({
      brief: "A missing cake",
      targetAge: 6,
    });
    const older = await buildBlueprintGenerationChatInput({
      brief: "A missing cake",
      targetAge: 12,
    });
    expect(young.systemPrompt).not.toBe(older.systemPrompt);

    const { workspace } = await runWrapper({ renderedPrompt: older.systemPrompt });
    const seen = await fs.readFile(
      path.join(workspace, "prompt-seen-by-agent.md"),
      "utf8",
    );
    expect(seen).toContain(renderGenerationGuidance(12));
    expect(seen).not.toContain(renderGenerationGuidance(6));
  });

  it("keeps the canonical prompt and warns when run by hand without a rendered prompt", async () => {
    const { result, workspace } = await runWrapper({ renderedPrompt: null });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("no rendered system prompt");

    const workspacePrompt = path.join(workspace, "prompts/generator-prompt.md");
    expect((await fs.lstat(workspacePrompt)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(workspacePrompt, "utf8")).toBe(
      await fs.readFile(CANONICAL_PROMPT, "utf8"),
    );
    expect(JSON.parse(result.stdout)).toHaveProperty("result");
  });

  it("keeps the canonical prompt and warns when the rendered prompt file is missing", async () => {
    const { result, workspace } = await runWrapper({ renderedPrompt: undefined });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("no rendered system prompt");
    expect(
      (await fs.lstat(path.join(workspace, "prompts/generator-prompt.md")))
        .isSymbolicLink(),
    ).toBe(true);
  });
});
