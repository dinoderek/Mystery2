import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, internalError, notFound } from "../_shared/errors.ts";
import {
  isImageReferenced,
  loadBlueprintRuntime,
} from "../_shared/blueprints/runtime.ts";
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

    const runtime = await loadBlueprintRuntime(userClient, blueprintId);
    if (!runtime) {
      return notFound("Blueprint not found");
    }

    if (!isImageReferenced(runtime, purpose, imageId)) {
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
