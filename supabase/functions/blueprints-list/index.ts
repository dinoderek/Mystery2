import { createClient } from "../_shared/db.ts";
import { internalError } from "../_shared/errors.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabase = createClient();
    const { data: files, error } = await supabase.storage
      .from("blueprints")
      .list();

    if (error) {
      console.error(error);
      return internalError("Failed to list blueprints");
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ blueprints: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const blueprints = [];
    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;

      const { data: fileData, error: downloadError } = await supabase.storage
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
        const parsed = BlueprintSchema.parse(rawJson);
        blueprints.push({
          id: parsed.id,
          title: parsed.metadata.title,
          one_liner: parsed.metadata.one_liner,
          target_age: parsed.metadata.target_age,
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
    return internalError("Failed to fetch blueprints");
  }
});
