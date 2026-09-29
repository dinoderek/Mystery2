// The narrator, run through the `claude` command-line client.
//
// For machines that can reach Anthropic through a logged-in Claude Code but
// not OpenRouter. Each call is one `claude --print` subprocess carrying the
// same two messages the OpenRouter provider sends, so the prompt under test is
// the production prompt. Role outputs are constrained with `--json-schema`,
// generated from the same Zod schema the role's parser uses.
//
// The flags keep Claude Code's own system prompt, tools, MCP servers and
// settings (which include this repo's CLAUDE.md) out of the model's context,
// and the process runs outside the repo. The evaluation wrappers
// (evaluation/runtime/config/wrappers/claude-runtime.sh and
// evaluation/trace/config/wrappers/claude-trace-judge.sh) use the same flags.

import { spawn } from "node:child_process";
import os from "node:os";

import { roleOutputJsonSchema } from "./ai-contracts.ts";
import type {
  AICallUsage,
  AIProvider,
  AIRequestMetadata,
  AIRoleOutputRequest,
  AIRuntimeProfile,
} from "./ai-provider.ts";
import { RetriableAIError } from "./errors.ts";

export interface ClaudeCliRuntimeConfig {
  /** The `claude` executable: `CLAUDE_CLI_PATH`, else `claude` on PATH. */
  binary: string;
  timeout_ms: number;
  max_attempts: number;
  base_backoff_ms: number;
}

const ISOLATION_FLAGS = [
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--no-session-persistence",
];

const NARRATION_SYSTEM_PROMPT =
  "You are the narrator for a kids mystery game. Return plain text only.";

/** The fields of the CLI's `--output-format json` reply this provider reads. */
interface CliReply {
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, { outputTokens?: number }>;
}

interface CliCall {
  role: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown> | null;
  /** Throws a RetriableAIError when the reply lacks what the caller needs. */
  check: (reply: CliReply) => void;
}

export class ClaudeCliProvider implements AIProvider {
  readonly profile: AIRuntimeProfile;
  readonly #config: ClaudeCliRuntimeConfig;
  #resolvedModel: string;
  #lastUsage: AICallUsage | null = null;

  constructor(profile: AIRuntimeProfile, config: ClaudeCliRuntimeConfig) {
    this.profile = profile;
    this.#config = config;
    this.#resolvedModel = profile.model;
  }

  get resolvedModel(): string {
    return this.#resolvedModel;
  }

  get lastUsage(): AICallUsage | null {
    return this.#lastUsage;
  }

  async generateNarration(
    prompt: string,
    metadata?: AIRequestMetadata,
  ): Promise<string> {
    const reply = await this.#call(
      {
        role: "narration",
        system: NARRATION_SYSTEM_PROMPT,
        user: prompt,
        jsonSchema: null,
        check: (candidate) => {
          if (typeof candidate.result !== "string" || !candidate.result.trim()) {
            throw new RetriableAIError("claude CLI returned no narration", {
              code: "CLAUDE_CLI_EMPTY_RESULT",
            });
          }
        },
      },
      metadata,
    );
    return (reply.result as string).trim();
  }

  async generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T> {
    const reply = await this.#call(
      {
        role: request.role,
        system:
          `You are a strict JSON API for role "${request.role}". Output JSON only.`,
        user: JSON.stringify({ prompt: request.prompt, context: request.context }),
        jsonSchema: roleOutputJsonSchema(request.role),
        check: (candidate) => {
          const output = candidate.structured_output;
          if (typeof output !== "object" || output === null || Array.isArray(output)) {
            throw new RetriableAIError(
              `claude CLI returned no structured output for ${request.role}`,
              { code: "CLAUDE_CLI_NO_STRUCTURED_OUTPUT" },
            );
          }
        },
      },
      request.metadata,
    );
    // A reply that fits the schema but breaks a rule the schema cannot express
    // (a `continue` judgement with no follow-up) fails here, unretried, the
    // same as an OpenRouter reply that fails its parser.
    return request.parse(reply.structured_output);
  }

  async #call(call: CliCall, metadata?: AIRequestMetadata): Promise<CliReply> {
    const baseLogData: Record<string, unknown> = {
      request_id: metadata?.request_id ?? "untracked",
      endpoint: metadata?.endpoint ?? "unknown",
      action: metadata?.action ?? "unknown",
      game_id: metadata?.game_id ?? null,
      role: call.role,
      provider: this.profile.provider,
      model: this.profile.model,
    };

    for (let attempt = 1; attempt <= this.#config.max_attempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const reply = await this.#runOnce(call);
        call.check(reply);
        this.#recordReply(reply, attempt);
        this.#log({
          ...baseLogData,
          outcome: "success",
          attempt,
          latency_ms: Date.now() - startedAt,
          responded_model: this.#resolvedModel,
          cost_usd: this.#lastUsage?.cost_usd ?? null,
        });
        return reply;
      } catch (error) {
        const retriable = error instanceof RetriableAIError;
        const isRetrying = retriable && attempt < this.#config.max_attempts;
        this.#log({
          ...baseLogData,
          outcome: isRetrying ? "retry" : "failure",
          attempt,
          latency_ms: Date.now() - startedAt,
          retriable,
          retriable_code: retriable ? error.details.code ?? null : null,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!isRetrying) throw error;
        await sleep(backoff(this.#config.base_backoff_ms, attempt));
      }
    }

    throw new Error("claude CLI retry loop exited unexpectedly");
  }

  #runOnce(call: CliCall): Promise<CliReply> {
    const args = [
      "--print",
      "--model",
      this.profile.model,
      "--output-format",
      "json",
      "--system-prompt",
      call.system,
      ...ISOLATION_FLAGS,
      ...(call.jsonSchema ? ["--json-schema", JSON.stringify(call.jsonSchema)] : []),
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.#config.binary, args, {
        cwd: os.tmpdir(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(() =>
          reject(
            new RetriableAIError("claude CLI request timed out", {
              code: "CLAUDE_CLI_TIMEOUT",
            }),
          )
        );
      }, this.#config.timeout_ms);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      // A child that exits before reading its input closes the pipe; the exit
      // code reports that failure, so the pipe error itself is not news.
      child.stdin.on("error", () => {});

      child.on("error", (error) => {
        settle(() =>
          reject(
            new Error(
              `Could not run the claude CLI at "${this.#config.binary}": ${error.message}`,
            ),
          )
        );
      });

      child.on("close", (code) => {
        settle(() => {
          let reply: CliReply | null = null;
          try {
            reply = JSON.parse(stdout) as CliReply;
          } catch {
            // Reported below, with the exit code when there is one.
          }

          if (reply?.is_error) {
            const reason = typeof reply.result === "string" ? reply.result : "unknown error";
            reject(
              new RetriableAIError(`claude CLI reported an error: ${reason}`, {
                code: "CLAUDE_CLI_ERROR",
              }),
            );
          } else if (code !== 0) {
            reject(
              new RetriableAIError(`claude CLI exited with code ${code}`, {
                code: "CLAUDE_CLI_FAILED",
                stderr: stderr.slice(-500),
              }),
            );
          } else if (!reply) {
            reject(
              new RetriableAIError("claude CLI returned output that is not JSON", {
                code: "CLAUDE_CLI_BAD_OUTPUT",
              }),
            );
          } else {
            resolve(reply);
          }
        });
      });

      child.stdin.end(call.user);
    });
  }

  #recordReply(reply: CliReply, attempts: number): void {
    // The CLI reports usage per model id. The one that wrote the answer is the
    // one with the most output, and its id is the full name behind an alias
    // such as "sonnet".
    const models = Object.entries(reply.modelUsage ?? {});
    if (models.length > 0) {
      models.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0));
      this.#resolvedModel = models[0][0];
    }

    const usage = reply.usage ?? {};
    this.#lastUsage = {
      input_tokens: (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens ?? 0,
      cost_usd: typeof reply.total_cost_usd === "number" ? reply.total_cost_usd : null,
      attempts,
    };
  }

  #log(payload: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "ai.claude_cli.call",
        ...payload,
      }),
    );
  }
}

function backoff(baseMs: number, attempt: number): number {
  return Math.min(baseMs * Math.max(1, 2 ** (attempt - 1)), 15_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
