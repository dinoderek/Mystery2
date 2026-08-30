import type { EngineContext } from "../context.ts";
import { createRequestLogger } from "../logging.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "blueprints-list");

  try {
    const entries = await ctx.content.listBlueprints(logger);

    const blueprints = entries.map(({ blueprint }) => ({
      id: blueprint.id,
      title: blueprint.metadata.title,
      one_liner: blueprint.metadata.one_liner,
      target_age: blueprint.metadata.target_age,
      blueprint_image_id: blueprint.metadata.image_id ?? null,
    }));

    return new Response(JSON.stringify({ blueprints }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.logError("request.error", {
      reason: "blueprint_list_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Failed to fetch blueprints" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
