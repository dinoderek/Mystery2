import { BlueprintScenesRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import type { CatalogContext } from "../context.ts";
import { createRequestLogger } from "../logging.ts";

export async function handle(req: Request, ctx: CatalogContext): Promise<Response> {
  const parsed = BlueprintScenesRequestSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid blueprint_id" }, { status: 400 });
  const logger = createRequestLogger(req, "blueprint-scenes");
  const blueprintId = parsed.data.blueprint_id;
  try {
    const blueprint = await ctx.content.loadBlueprint(blueprintId, logger);
    if (!blueprint) return Response.json({ error: "Blueprint not found" }, { status: 404 });
    const manifest = await ctx.content.loadScenes(blueprint);
    return Response.json(manifest ?? { schema_version: "scene/1", blueprint_id: blueprintId, scenes: [] });
  } catch (error) {
    logger.logError("request.error", { blueprint_id: blueprintId, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Scene artwork is unavailable" }, { status: 500 });
  }
}
