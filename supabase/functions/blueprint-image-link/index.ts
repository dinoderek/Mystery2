import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, internalError, notFound } from "../_shared/errors.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { serveWithCors } from "../_shared/cors.ts";
import {
  BLUEPRINT_IMAGES_BUCKET,
  buildImageStorageCandidates,
  ensureCanonicalImageId,
  IMAGE_LINK_TTL_SECONDS,
  normalizeSignedUrlExpiry,
} from "../_shared/images.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSES = new Set([
  "blueprint_cover",
  "location_scene",
  "character_portrait",
] as const);

type ImagePurpose = "blueprint_cover" | "location_scene" | "character_portrait";

function isImageReferenced(
  blueprint: ReturnType<typeof BlueprintSchema.parse>,
  purpose: ImagePurpose,
  imageId: string,
): boolean {
  if (purpose === "blueprint_cover") {
    return blueprint.metadata.image_id === imageId;
  }

  if (purpose === "location_scene") {
    return blueprint.world.locations.some((location) =>
      location.location_image_id === imageId
    );
  }

  return blueprint.world.characters.some((character) =>
    character.portrait_image_id === imageId
  );
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const body = await req.json().catch(() => null);
    const blueprintId = typeof body?.blueprint_id === "string"
      ? body.blueprint_id
      : "";
    const imageId = ensureCanonicalImageId(body?.image_id);
    const purpose = typeof body?.purpose === "string" && PURPOSES.has(body.purpose)
      ? body.purpose as ImagePurpose
      : null;

    if (!UUID_PATTERN.test(blueprintId)) {
      return badRequest("Invalid blueprint_id");
    }
    if (!imageId) {
      return badRequest("Invalid image_id");
    }
    if (!purpose) {
      return badRequest("Invalid purpose");
    }

    const { data: fileData, error: downloadError } = await userClient.storage
      .from("blueprints")
      .download(`${blueprintId}.json`);
    if (downloadError || !fileData) {
      return notFound("Blueprint not found");
    }

    const rawBlueprint = await fileData.text();
    const blueprint = BlueprintSchema.parse(JSON.parse(rawBlueprint));
    if (!isImageReferenced(blueprint, purpose, imageId)) {
      return notFound("Image not referenced by blueprint");
    }

    for (const key of buildImageStorageCandidates(blueprintId, imageId)) {
      const { data, error } = await userClient.storage
        .from(BLUEPRINT_IMAGES_BUCKET)
        .createSignedUrl(key, IMAGE_LINK_TTL_SECONDS);

      if (!error && data?.signedUrl) {
        return new Response(
          JSON.stringify({
            image_id: imageId,
            signed_url: data.signedUrl,
            expires_at: normalizeSignedUrlExpiry(),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
    }

    return notFound("Image asset not found");
  } catch (error) {
    console.error("blueprint-image-link failed", error);
    return internalError("Failed to issue image link");
  }
});
