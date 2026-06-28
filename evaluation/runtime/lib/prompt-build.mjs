// Faithful runtime-prompt assembly for the CLI backend.
//
// Reuses the REAL prompt templates and context builders from
// supabase/functions/_shared so there is a single source of truth — no
// duplicated prompt text. Node 24 strips TypeScript types on import, so these
// Deno-authored .ts modules load directly (they have no value imports beyond
// each other and no Deno-only globals on these code paths).
//
// The produced { system, user } pair is byte-for-byte what the OpenRouter
// provider sends for a role output (see OpenRouterProvider.generateRoleOutput in
// ai-provider.ts): a strict-JSON system message plus a user message carrying
// JSON.stringify({ prompt, context }).

let cached = null;

async function loadShared() {
  if (cached) return cached;
  const ctx = await import("../../../supabase/functions/_shared/ai-context.ts");
  const prompts = await import("../../../supabase/functions/_shared/ai-prompts.ts");
  cached = { ctx, prompts };
  return cached;
}

/**
 * Build the model request for one role.
 *   role:        AIPromptKey (e.g. "talk_conversation")
 *   builder:     name of the ai-context.ts builder to call (e.g. "buildTalkConversationContext")
 *   contextInput: the builder's input object
 *   promptVars:  variables for renderPrompt of the role template
 * Returns { system, user, prompt, context }.
 */
export async function buildRoleRequest({ role, builder, contextInput, promptVars }) {
  const { ctx, prompts } = await loadShared();
  const build = ctx[builder];
  if (typeof build !== "function") {
    throw new Error(`Unknown context builder "${builder}"`);
  }
  const context = build(contextInput);
  const template = await prompts.loadPromptTemplate(role);
  const prompt = prompts.renderPrompt(template, promptVars);
  return {
    system: `You are a strict JSON API for role "${role}". Output JSON only.`,
    user: JSON.stringify({ prompt, context }),
    prompt,
    context,
  };
}
