import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parseReply } from "../../../evaluation/playtest/lib/investigator.ts";

it("runs OpenRouter as one binding call, retaining raw usage and supporting prose and investigator output", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openrouter-wrapper-"));
  const wrapperDir = path.join(dir, "evaluation/runtime/config/wrappers");
  fs.mkdirSync(wrapperDir, { recursive: true });
  for (const name of ["openrouter-runtime.sh", "openrouter-runtime.ts"]) fs.copyFileSync(path.join("evaluation/runtime/config/wrappers", name), path.join(wrapperDir, name));
  fs.symlinkSync(path.resolve("packages"), path.join(dir, "packages"));
  fs.writeFileSync(path.join(dir, ".env.local"), "OPENROUTER_API_KEY=test-key\n");
  const captured: Array<Record<string, unknown>> = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    captured.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: "test", choices: [{ message: { content: captured.length === 1 ? "A warm arrival." : '{"input":"search","plan":"Look here."}' } }], usage: { cost: 0.02, prompt_tokens: 10, completion_tokens: 5 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(dir, "system"), "Original system text.");
  fs.writeFileSync(path.join(dir, "user"), "Original user text: é 🐾");
  const invoke = async (format: string) => {
    const result = await promisify(execFile)("bash", [path.join(wrapperDir, "openrouter-runtime.sh"), path.join(dir, "system"), path.join(dir, "user")], { env: { ...process.env, MYSTERY_CONFIG_ROOT: "", OPENROUTER_API_KEY: "", EVAL_MODEL: "test", EVAL_OUTPUT_FORMAT: format, OPENROUTER_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` } });
    return JSON.parse(result.stdout);
  };
  try {
    const prose = await invoke("text");
    expect(prose.result).toBe("A warm arrival.");
    expect(captured[0]).toEqual({ model: "test", messages: [{ role: "system", content: "Original system text." }, { role: "user", content: "Original user text: é 🐾" }] });
    const decision = await invoke("json");
    expect(captured[1].response_format).toEqual({ type: "json_object" });
    expect(parseReply(JSON.stringify(decision))).toEqual({ input: "search", plan: "Look here.", model: "test" });
    expect(decision.total_cost_usd).toBe(0.02);
    expect(decision.raw_response.usage).toEqual({ cost: 0.02, prompt_tokens: 10, completion_tokens: 5 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
