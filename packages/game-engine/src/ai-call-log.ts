// A JSON-lines record of every AI call, for reading a played game back.
//
// Switched on by `AI_CALL_LOG=<file>` and off otherwise. It wraps whichever
// provider the profile resolves to, so mock, OpenRouter and the claude CLI log
// the same way. Each line holds what the role was asked (prompt and context),
// what came back before parsing, and what it cost where the provider reports it.
//
// The context carries blueprint content, the solution included for the
// accusation judge. The file is for local runs and belongs in a gitignored
// folder.

import fs from "node:fs";
import path from "node:path";

import type {
  AICallUsage,
  AIProvider,
  AIRequestMetadata,
  AIRoleOutputRequest,
} from "./ai-provider.ts";

interface CallRecord {
  role: string;
  prompt: string;
  context: Record<string, unknown> | null;
  output: unknown;
  parsed_ok: boolean;
  error: string | null;
  metadata?: AIRequestMetadata;
  startedAt: number;
}

export function withCallLog(provider: AIProvider, file: string): AIProvider {
  const write = (record: CallRecord) => {
    const usage = provider.lastUsage ?? null;
    const line = {
      ts: new Date().toISOString(),
      game_id: record.metadata?.game_id ?? null,
      endpoint: record.metadata?.endpoint ?? null,
      action: record.metadata?.action ?? null,
      request_id: record.metadata?.request_id ?? null,
      role: record.role,
      provider: provider.profile.provider,
      model: provider.profile.model,
      resolved_model: provider.resolvedModel,
      prompt: record.prompt,
      context: record.context,
      output: record.output,
      parsed_ok: record.parsed_ok,
      error: record.error,
      latency_ms: Date.now() - record.startedAt,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cost_usd: usage?.cost_usd ?? null,
      attempts: usage?.attempts ?? null,
    };
    // The log is a debugging aid: failing to write it must not fail the turn.
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch (error) {
      console.error(`AI call log: could not write ${file}: ${String(error)}`);
    }
  };

  return {
    profile: provider.profile,
    get resolvedModel(): string {
      return provider.resolvedModel;
    },
    get lastUsage(): AICallUsage | null {
      return provider.lastUsage ?? null;
    },

    async generateNarration(prompt, metadata) {
      const startedAt = Date.now();
      try {
        const narration = await provider.generateNarration(prompt, metadata);
        write({
          role: "narration",
          prompt,
          context: null,
          output: narration,
          parsed_ok: true,
          error: null,
          metadata,
          startedAt,
        });
        return narration;
      } catch (error) {
        write({
          role: "narration",
          prompt,
          context: null,
          output: null,
          parsed_ok: false,
          error: String(error),
          metadata,
          startedAt,
        });
        throw error;
      }
    },

    async generateRoleOutput<T>(request: AIRoleOutputRequest<T>): Promise<T> {
      const startedAt = Date.now();
      // Seen through the parser, so the log keeps the model's own output even
      // when parsing rejects it.
      let raw: unknown = null;
      const parse = (payload: unknown): T => {
        raw = payload;
        return request.parse(payload);
      };
      const record = {
        role: request.role,
        prompt: request.prompt,
        context: request.context,
        metadata: request.metadata,
        startedAt,
      };
      try {
        const output = await provider.generateRoleOutput({ ...request, parse });
        write({ ...record, output: raw, parsed_ok: true, error: null });
        return output;
      } catch (error) {
        write({ ...record, output: raw, parsed_ok: false, error: String(error) });
        throw error;
      }
    },
  };
}
