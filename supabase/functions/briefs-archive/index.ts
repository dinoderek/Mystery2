import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, internalError, notFound } from "../_shared/errors.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }

    const { client } = authResult;

    let body: { brief_id?: string; restore?: boolean };
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid request body");
    }

    if (!body.brief_id || typeof body.brief_id !== "string") {
      return badRequest("Missing or invalid brief_id");
    }

    const archivedAt = body.restore === true ? null : new Date().toISOString();

    const { data: updated, error: updateError } = await client
      .from("briefs")
      .update({
        archived_at: archivedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.brief_id)
      .select("id, archived_at")
      .maybeSingle();

    if (updateError) {
      console.error("briefs-archive update error:", updateError);
      return internalError("Failed to archive brief");
    }

    if (!updated) {
      return notFound("Brief not found");
    }

    return new Response(JSON.stringify({ brief: updated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return internalError("Internal Server Error");
  }
});
