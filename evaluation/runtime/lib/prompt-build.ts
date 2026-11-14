// Runtime-prompt assembly for the CLI narrators.
//
// This is a thin transport wrapper: the assembly itself lives in
// packages/game-engine/src/role-request.ts, the SAME module the server
// handlers call. Node 24 strips TypeScript types on import, so that module
// loads directly — it imports only its siblings and touches neither the
// network nor the database, a purity contract documented there and worth
// preserving.
//
// Sharing the assembly means there is no second implementation to drift: a
// replayed prompt is built for the blueprint's real target age and narration
// style, the same as the server's.
//
// The produced { system, user } pair is what the OpenRouter provider sends for
// a role output (see OpenRouterProvider.generateRoleOutput in ai-provider.ts):
// a strict-JSON system message plus a user message carrying
// JSON.stringify({ prompt, context }).

import * as shared from "../../../packages/game-engine/src/role-request.ts";
import type { NarrationRoleInput, TemplateRoleInput } from "../../../packages/game-engine/src/role-request.ts";

export interface ModelRequest {
  system: string;
  user: string;
  prompt: string;
  context: unknown;
}

/**
 * Build the model request for one role-output role.
 *   input: a RoleRequestInput (see role-request.ts) — `role` plus the
 *          blueprint, session, history and role-specific fields.
 */
export async function buildRoleRequest(input: TemplateRoleInput): Promise<ModelRequest> {
  const { role, prompt, context } = await shared.buildRoleRequest(input);
  return {
    system: `You are a strict JSON API for role "${role}". Output JSON only.`,
    user: JSON.stringify({ prompt, context }),
    prompt,
    context,
  };
}

/** Build the prompt for a narration role (`intro`, `ambience`). */
export function buildNarrationPrompt(input: NarrationRoleInput): string {
  return shared.buildNarrationPrompt(input);
}

/** Re-exported so callers resolve roles the same way the handlers do. */
export const { resolveSearchRole, resolveAccusationRole } = shared;
