import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { internalError } from "../_shared/errors.ts";
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;
    const { data: files, error } = await userClient.storage
      .from("blueprints")
      .list();

    if (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: "Failed to list blueprints" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ blueprints: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const blueprints = [];
    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;

      const { data: fileData, error: downloadError } = await userClient.storage
        .from("blueprints")
        .download(file.name);

      if (downloadError) {
        console.error(
          "Failed to download blueprint:",
          file.name,
          downloadError,
        );
        continue;
      }

      const text = await fileData.text();
      let rawJson;
      try {
        rawJson = JSON.parse(text);
      } catch (e) {
        console.error("Invalid JSON in blueprint:", file.name);
        continue;
      }

      try {
        const parsed = BlueprintV2Schema.parse(rawJson);
        blueprints.push({
          id: parsed.id,
          title: parsed.metadata.title,
          one_liner: parsed.metadata.one_liner,
          target_age: parsed.metadata.target_age,
          blueprint_image_id: parsed.metadata.image_id ?? null,
        });
      } catch (e) {
        console.error("Blueprint schema validation failed:", file.name, e);
      }
    }

    return new Response(JSON.stringify({ blueprints }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Failed to fetch blueprints" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
