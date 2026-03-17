import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { internalError } from "../_shared/errors.ts";
import { listBlueprintsFromStorage } from "../_shared/blueprints/runtime.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }

    const blueprints = await listBlueprintsFromStorage(authResult.client);

    return new Response(
      JSON.stringify({
        blueprints: blueprints.map((blueprint) => ({
          id: blueprint.id,
          title: blueprint.metadata.title,
          one_liner: blueprint.metadata.one_liner,
          target_age: blueprint.metadata.target_age,
          blueprint_image_id: blueprint.metadata.image_id ?? null,
        })),
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(error);
    return internalError("Failed to fetch blueprints");
  }
});
