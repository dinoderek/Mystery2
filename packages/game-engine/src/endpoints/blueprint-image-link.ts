import type { EngineContext } from "../context.ts";
import { badRequest, internalError, notFound } from "../errors.ts";
import type { BlueprintV2 } from "../../../shared/src/blueprint-schema-v2.ts";
import { createRequestLogger } from "../logging.ts";
import {
  buildImageStorageKey,
  ensureCanonicalImageId,
  IMAGE_LINK_TTL_SECONDS,
  normalizeSignedUrlExpiry,
  toRelativeSignedUrl,
} from "../images.ts";

function isImageReferenced(
  blueprint: BlueprintV2,
  imageId: string,
): boolean {
  if (blueprint.metadata.image_id === imageId) {
    return true;
  }

  if (blueprint.world.locations.some((location) =>
    location.location_image_id === imageId
  )) {
    return true;
  }

  return blueprint.world.characters.some((character) =>
    character.portrait_image_id === imageId
  );
}

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    const blueprintId = typeof body?.blueprint_id === "string"
      ? body.blueprint_id
      : "";
    const imageId = ensureCanonicalImageId(body?.image_id);

    if (!blueprintId) {
      return badRequest("Missing blueprint_id");
    }
    if (!imageId) {
      return badRequest("Invalid image_id");
    }

    const logger = createRequestLogger(req, "blueprint-image-link");
    const blueprint = await ctx.content.loadBlueprint(blueprintId, logger);
    if (!blueprint) {
      return notFound("Blueprint not found");
    }
    if (!isImageReferenced(blueprint, imageId)) {
      return notFound("Image not referenced by blueprint");
    }

    const storageKey = buildImageStorageKey(blueprintId, imageId);
    const signedUrl = await ctx.content.imageUrl(storageKey, IMAGE_LINK_TTL_SECONDS);

    if (signedUrl) {
      return new Response(
        JSON.stringify({
          image_id: imageId,
          signed_url: toRelativeSignedUrl(signedUrl),
          expires_at: normalizeSignedUrlExpiry(),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return notFound("Image asset not found");
  } catch (error) {
    console.error("blueprint-image-link failed", error);
    return internalError("Failed to issue image link");
  }
}
