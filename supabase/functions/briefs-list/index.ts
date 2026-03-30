import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { internalError } from "../_shared/errors.ts";
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

    const { client } = authResult;

    let includeArchived = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        includeArchived = body?.include_archived === true;
      } catch {
        // Empty body is fine — default to active only.
      }
    }

    let query = client
      .from("briefs")
      .select(
        "id, brief, title_hint, target_age, created_at, updated_at, archived_at",
      )
      .order("updated_at", { ascending: false });

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data: briefs, error: queryError } = await query;

    if (queryError) {
      console.error("briefs-list query error:", queryError);
      return internalError("Failed to fetch briefs");
    }

    return new Response(JSON.stringify({ briefs: briefs ?? [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return internalError("Internal Server Error");
  }
});
