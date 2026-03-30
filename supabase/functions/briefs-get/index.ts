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

    let body: { brief_id?: string };
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid request body");
    }

    if (!body.brief_id || typeof body.brief_id !== "string") {
      return badRequest("Missing or invalid brief_id");
    }

    const { data: brief, error: queryError } = await client
      .from("briefs")
      .select("*")
      .eq("id", body.brief_id)
      .maybeSingle();

    if (queryError) {
      console.error("briefs-get query error:", queryError);
      return internalError("Failed to fetch brief");
    }

    if (!brief) {
      return notFound("Brief not found");
    }

    return new Response(JSON.stringify({ brief }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return internalError("Internal Server Error");
  }
});
