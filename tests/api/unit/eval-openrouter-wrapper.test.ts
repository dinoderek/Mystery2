// The `api` generation backend: the wrapper's request is the one the generator
// package has always sent (strict response format, image fields stripped), the
// key comes from the environment or `.env.local`, and it is never written
// anywhere. Calls go to a fake `fetch` or to a local HTTP server; no model and
// no network are used.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import { describeFailure, generateViaOpenRouter, readOpenRouterKey } from "../../../evaluation/generate/openrouter.ts";
import { buildBlueprintGenerationChatInput, generateBlueprint } from "../../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";
import { generatorBrief } from "./fixtures/generator-brief.ts";

const KEY = "sk-or-test-key-0123456789";
const MODEL = "vendor/some-model";
const IMAGE_IDS = { image_id: "img-cover" };

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-openrouter-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function userMessage(): string {
  const file = path.join(dir, "user.json");
  fs.writeFileSync(file, JSON.stringify({ story_brief: generatorBrief, instructions: "ignored: the request builds its own" }));
  return file;
}

function completion(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
}

/** A fetch that records each request and answers with `content`. */
function fakeFetch(content: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return completion(content);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("the api wrapper's request", () => {
  it("is the request generateBlueprint sends: the generator prompt, a strict schema without image fields, the brief", async () => {
    const wrapped = fakeFetch(validBlueprintV2);
    const direct = fakeFetch(validBlueprintV2);
    await generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl: wrapped.impl });
    await generateBlueprint({ storyBrief: generatorBrief, model: MODEL, openRouterApiKey: KEY, fetchImpl: direct.impl });

    expect(wrapped.calls).toHaveLength(1);
    expect(wrapped.calls[0].body).toEqual(direct.calls[0].body);
    expect(wrapped.calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(wrapped.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);

    const chatInput = await buildBlueprintGenerationChatInput(generatorBrief);
    const { body } = wrapped.calls[0];
    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual([
      { role: "system", content: chatInput.systemPrompt },
      { role: "user", content: chatInput.userMessageContent },
    ]);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "BlueprintV2", strict: true } });
    expect(body.provider).toEqual({ require_parameters: true });
    const schema = JSON.stringify(body.response_format.json_schema.schema);
    for (const field of ["image_id", "location_image_id", "portrait_image_id"]) expect(schema).not.toContain(`"${field}"`);
  });

  it("prints the blueprint in the envelope the binding reads, with returned image fields stripped", async () => {
    const withImages = { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, ...IMAGE_IDS } };
    const stdout = await generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl: fakeFetch(withImages).impl });
    const blueprint = JSON.parse(JSON.parse(stdout).result);
    expect(blueprint).toEqual(BlueprintV2Schema.parse(validBlueprintV2));
    expect(blueprint.metadata).not.toHaveProperty("image_id");
  });

  it("still prints a blueprint that fails the schema, so the command can keep and check it", async () => {
    const stdout = await generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl: fakeFetch({ title: "x" }).impl });
    expect(JSON.parse(JSON.parse(stdout).result)).toEqual({ title: "x" });
  });

  it("prints a failing blueprint as it was checked, without the nulls strict mode forced", async () => {
    const answer = { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, art_style: null, title: "" } };
    const stdout = await generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl: fakeFetch(answer).impl });
    const printed = JSON.parse(JSON.parse(stdout).result);
    expect(printed.metadata).not.toHaveProperty("art_style");
    const issues = BlueprintV2Schema.safeParse(printed).error?.issues.map((issue) => issue.path.join("."));
    expect(issues).toEqual(["metadata.title"]);
  });

  it("sends to OPENROUTER_URL when it is set, with the timeout from AI_OPENROUTER_TIMEOUT_MS", async () => {
    const wrapped = fakeFetch(validBlueprintV2);
    const env = { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY, OPENROUTER_URL: "http://127.0.0.1:9/chat", AI_OPENROUTER_TIMEOUT_MS: "5000" };
    await generateViaOpenRouter({ userMessageFile: userMessage(), env, fetchImpl: wrapped.impl });
    expect(wrapped.calls[0].url).toBe("http://127.0.0.1:9/chat");
    await expect(
      generateViaOpenRouter({ userMessageFile: userMessage(), env: { ...env, AI_OPENROUTER_TIMEOUT_MS: "soon" }, fetchImpl: wrapped.impl }),
    ).rejects.toThrow("Invalid AI_OPENROUTER_TIMEOUT_MS");
  });
});

describe("the api wrapper's failures", () => {
  it("needs a model and a key, and a story brief in the message", async () => {
    const fetchImpl = fakeFetch(validBlueprintV2).impl;
    await expect(generateViaOpenRouter({ userMessageFile: userMessage(), env: { OPENROUTER_API_KEY: KEY }, fetchImpl })).rejects.toThrow("no model");
    await expect(generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL }, fetchImpl })).rejects.toThrow("OPENROUTER_API_KEY is not set");
    const empty = path.join(dir, "empty.json");
    fs.writeFileSync(empty, "{}");
    await expect(generateViaOpenRouter({ userMessageFile: empty, env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl })).rejects.toThrow("has no story_brief");
  });

  it("describes an HTTP failure by its code and status, never with the key or the request", async () => {
    const failing = (async () => new Response("upstream says no", { status: 503 })) as unknown as typeof fetch;
    const error = await generateViaOpenRouter({ userMessageFile: userMessage(), env: { EVAL_MODEL: MODEL, OPENROUTER_API_KEY: KEY }, fetchImpl: failing }).catch((e) => e);
    const text = describeFailure(error);
    expect(text).toBe("OPENROUTER_ERROR: OpenRouter request failed (503) (HTTP 503)");
    expect(text).not.toContain(KEY);
    expect(describeFailure(new Error("plain"))).toBe("plain");
    expect(describeFailure("odd")).toBe("odd");
  });
});

describe("readOpenRouterKey", () => {
  it("prefers the environment, then .env.local in the config root, then the repo's", () => {
    const root = path.join(dir, "repo");
    const configRoot = path.join(dir, "config");
    fs.mkdirSync(root);
    fs.mkdirSync(configRoot);
    fs.writeFileSync(path.join(configRoot, ".env.local"), `# a comment\nOPENROUTER_API_KEY="from-file"\n`);
    fs.writeFileSync(path.join(root, ".env.local"), "OPENROUTER_API_KEY=from-repo\n");

    expect(readOpenRouterKey({ OPENROUTER_API_KEY: " from-env ", MYSTERY_CONFIG_ROOT: configRoot }, root)).toBe("from-env");
    expect(readOpenRouterKey({ MYSTERY_CONFIG_ROOT: configRoot }, root)).toBe("from-file");
    expect(readOpenRouterKey({}, root)).toBe("from-repo");
    expect(readOpenRouterKey({ MYSTERY_CONFIG_ROOT: path.join(dir, "nowhere") }, root)).toBeNull();
  });
});

/** A local stand-in for OpenRouter that keeps what it is sent. */
async function fakeOpenRouter(content: unknown) {
  const requests: Array<{ authorization: string | undefined; body: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const server = http.createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      requests.push({ authorization: req.headers.authorization, body: JSON.parse(text) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { requests, url: `http://127.0.0.1:${port}/chat/completions`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("generate --backend api through the real wrapper", () => {
  it("runs the shell wrapper, sends the key and the brief once, and writes the key nowhere", async () => {
    const stand = await fakeOpenRouter({ ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, ...IMAGE_IDS } });
    try {
      vi.stubEnv("OPENROUTER_URL", stand.url);
      const config = path.join(dir, "config.json");
      fs.writeFileSync(
        config,
        JSON.stringify({
          "generator-api": {
            cmd: "evaluation/config/wrappers/openrouter-generate.sh",
            args: ["{{system_prompt_file}}", "{{user_message_file}}"],
            extract_path: "result",
            model: MODEL,
            timeout_ms: 60_000,
            retries: 0,
          },
        }),
      );
      const brief = path.join(dir, "brief.json");
      fs.writeFileSync(brief, JSON.stringify({ ...generatorBrief, witnesses: 0 }));
      const out: string[] = [];
      const code = await runEval(
        ["generate", brief, "--backend", "api", "--config", config, "--output-root", path.join(dir, "out"), "--quiet"],
        { root: process.cwd(), out: (t) => out.push(t), err: (t) => out.push(t), env: { OPENROUTER_API_KEY: KEY } },
        COMMANDS,
      );
      expect(out.join("\n")).not.toContain(KEY);
      expect(code).toBe(0);

      expect(stand.requests).toHaveLength(1);
      expect(stand.requests[0].authorization).toBe(`Bearer ${KEY}`);
      expect(stand.requests[0].body.model).toBe(MODEL);
      expect(stand.requests[0].body.response_format.json_schema.strict).toBe(true);

      const files = fs.readdirSync(path.join(dir, "out"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
      expect(files.length).toBeGreaterThan(5);
      for (const entry of files) expect(fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8")).not.toContain(KEY);
      const resultFile = files.find((entry) => entry.name === "result.json") as fs.Dirent;
      const result = await readResult(path.join(resultFile.parentPath, resultFile.name));
      expect(result.production?.calls[0]).toMatchObject({ binding: "generator-api", model: MODEL });
      const stored = JSON.parse(fs.readFileSync(path.join(resultFile.parentPath, "blueprint.json"), "utf8"));
      expect(stored.metadata).not.toHaveProperty("image_id");
    } finally {
      await stand.close();
    }
  });
});
