// Runtime-prompt assembly for the CLI backend.
//
// This is a thin transport wrapper: the assembly itself lives in
// packages/game-engine/src/role-request.ts, the SAME module the server
// handlers call. Node 24 strips TypeScript types on import, so that module
// loads directly — it imports only its siblings and touches neither the
// network nor the database, a purity contract documented there and worth
// preserving.
//
// It used to reimplement the assembly here, and drifted: it called
// loadPromptTemplate(role) with no target age, so clampTargetAge fell back to
// age 6 and every replayed prompt was built for the wrong reader while being
// graded against the blueprint's real age; narration_style never reached the
// model at all. Sharing the assembly removes that failure mode by construction
// — there is no second implementation left to drift.
//
// The produced { system, user } pair is what the OpenRouter provider sends for
// a role output (see OpenRouterProvider.generateRoleOutput in ai-provider.ts):
// a strict-JSON system message plus a user message carrying
// JSON.stringify({ prompt, context }).

let cached = null;

async function loadShared() {
  if (cached) return cached;
  cached = await import("../../../packages/game-engine/src/role-request.ts");
  return cached;
}

/**
 * Build the model request for one role-output role.
 *   input: a RoleRequestInput (see role-request.ts) — `role` plus the
 *          blueprint, session, history and role-specific fields.
 * Returns { system, user, prompt, context }.
 */
export async function buildRoleRequest(input) {
  const shared = await loadShared();
  const { role, prompt, context } = await shared.buildRoleRequest(input);
  return {
    system: `You are a strict JSON API for role "${role}". Output JSON only.`,
    user: JSON.stringify({ prompt, context }),
    prompt,
    context,
  };
}

/** Build the prompt for a narration role (`intro`, `ambience`). */
export async function buildNarrationPrompt(input) {
  const shared = await loadShared();
  return shared.buildNarrationPrompt(input);
}

/** Re-exported so callers resolve roles the same way the handlers do. */
export async function resolveSearchRole(searchQuery) {
  return (await loadShared()).resolveSearchRole(searchQuery);
}

export async function resolveAccusationRole(playerReasoning) {
  return (await loadShared()).resolveAccusationRole(playerReasoning);
}
