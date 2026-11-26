import { BlueprintsListRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import type { PlayableCase } from "../../../shared/src/playable-case.ts";
import { parseOneLinerOutput } from "../ai-contracts.ts";
import { createAIProviderFromProfile, createAIRequestMetadata } from "../ai-provider.ts";
import { DEFAULT_AI_PROFILE_ID, type EngineContext } from "../context.ts";
import { asRejectedResponse, RequestRejectedError } from "../errors.ts";
import { createRequestLogger } from "../logging.ts";
import { requestReadingAge } from "../reading-age.ts";
import { readJsonRequest, readQueryRequest } from "../request.ts";
import { buildOneLinerRequest } from "../role-request.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

// Per profile, because each case's line is narrated at the profile's reading
// age (see the access note in `index.ts`). The titles come back at once; asked
// for `one_liners`, the same list comes back with every line narrated in one
// model call, never cached and never the case's own text.
export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "blueprints-list");

  try {
    const read = req.method === "GET"
      ? readQueryRequest(req, BlueprintsListRequestSchema, logger)
      : await readJsonRequest(req, BlueprintsListRequestSchema, logger);
    if (!read.ok) return read.response;

    const entries = await ctx.content.listBlueprints(logger);
    const listed = entries.filter((entry) => !entry.unlisted).map(({ blueprint }) => blueprint);
    const lines = read.data.one_liners && listed.length > 0
      ? await narrateOneLiners(req, ctx, listed, logger)
      : new Map<string, string>();

    const blueprints = listed.map((blueprint) => ({
      id: blueprint.id,
      title: blueprint.metadata.title,
      one_liner: lines.get(blueprint.id) ?? null,
      blueprint_image_id: blueprint.metadata.image_id ?? null,
    }));

    return new Response(JSON.stringify({ blueprints }), { headers: JSON_HEADERS });
  } catch (err) {
    if (err instanceof RequestRejectedError) {
      logger.log("request.invalid", { reason: err.reason, error: err.message });
      return asRejectedResponse(err)!;
    }
    logger.logError("request.error", {
      reason: "blueprint_list_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Failed to fetch blueprints" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

/**
 * Every listed case's line, at the profile's age, from one call to the default
 * AI. A failure is logged here, once, and answered with no lines: the menu
 * then shows the titles alone.
 */
async function narrateOneLiners(
  req: Request,
  ctx: EngineContext,
  blueprints: PlayableCase[],
  logger: ReturnType<typeof createRequestLogger>,
): Promise<Map<string, string>> {
  // A profile without an age is refused, as a game is (`READING_AGE_REQUIRED`).
  const readingAge = await requestReadingAge(ctx.profile);
  const caseIds = blueprints.map((blueprint) => blueprint.id);
  try {
    const profile = await ctx.aiProfiles.getById(DEFAULT_AI_PROFILE_ID);
    if (!profile) throw new Error("No default AI profile configured");
    const provider = createAIProviderFromProfile(profile, { openrouterApiKey: profile.openrouter_api_key });
    const { role, prompt, context } = await buildOneLinerRequest({ role: "one_liner", blueprints, reading_age: readingAge });
    return await provider.generateRoleOutput({
      role,
      prompt,
      context,
      parse: (value) => parseOneLinerOutput(value, caseIds),
      metadata: createAIRequestMetadata(req, { request_id: logger.requestId, endpoint: "blueprints-list", action: "one_liner" }),
    });
  } catch (error) {
    logger.logError("request.error", {
      reason: "one_liner_failed",
      blueprint_ids: caseIds,
      reading_age: readingAge,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}
