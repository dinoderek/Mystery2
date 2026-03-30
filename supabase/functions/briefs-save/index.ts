import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, internalError, notFound } from "../_shared/errors.ts";
import { serveWithCors } from "../_shared/cors.ts";

interface BriefPayload {
  id?: string;
  brief: string;
  target_age: number;
  time_budget?: number | null;
  title_hint?: string | null;
  art_style?: string | null;
  must_include?: string[];
  culprits?: number | null;
  suspects?: number | null;
  locations?: number | null;
  witnesses?: number | null;
  red_herring_trails?: number | null;
  cover_ups?: boolean | null;
  elimination_complexity?: string | null;
}

const VALID_COMPLEXITY = ["simple", "moderate", "complex"];

function validatePayload(
  body: unknown,
): { data: BriefPayload; error?: undefined } | { data?: undefined; error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const p = body as Record<string, unknown>;

  if (typeof p.brief !== "string" || p.brief.trim().length === 0) {
    return { error: "brief is required and must be a non-empty string" };
  }

  if (typeof p.target_age !== "number" || !Number.isInteger(p.target_age) || p.target_age < 1) {
    return { error: "target_age is required and must be a positive integer" };
  }

  if (
    p.elimination_complexity != null &&
    !VALID_COMPLEXITY.includes(p.elimination_complexity as string)
  ) {
    return {
      error: `elimination_complexity must be one of: ${VALID_COMPLEXITY.join(", ")}`,
    };
  }

  if (p.must_include != null && !Array.isArray(p.must_include)) {
    return { error: "must_include must be an array of strings" };
  }

  return {
    data: {
      id: typeof p.id === "string" ? p.id : undefined,
      brief: (p.brief as string).trim(),
      target_age: p.target_age as number,
      time_budget: typeof p.time_budget === "number" ? p.time_budget : null,
      title_hint: typeof p.title_hint === "string" && p.title_hint.trim()
        ? p.title_hint.trim()
        : null,
      art_style: typeof p.art_style === "string" && p.art_style.trim()
        ? p.art_style.trim()
        : null,
      must_include: Array.isArray(p.must_include)
        ? (p.must_include as string[]).filter((s) => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
        : [],
      culprits: typeof p.culprits === "number" ? p.culprits : null,
      suspects: typeof p.suspects === "number" ? p.suspects : null,
      locations: typeof p.locations === "number" ? p.locations : null,
      witnesses: typeof p.witnesses === "number" ? p.witnesses : null,
      red_herring_trails: typeof p.red_herring_trails === "number"
        ? p.red_herring_trails
        : null,
      cover_ups: typeof p.cover_ups === "boolean" ? p.cover_ups : null,
      elimination_complexity: typeof p.elimination_complexity === "string"
        ? p.elimination_complexity
        : null,
    },
  };
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }

    const { client, user } = authResult;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid request body");
    }

    const validation = validatePayload(body);
    if (validation.error) {
      return badRequest(validation.error);
    }

    const payload = validation.data;
    const { id, ...fields } = payload;

    if (id) {
      // Update existing brief
      const { data: updated, error: updateError } = await client
        .from("briefs")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .maybeSingle();

      if (updateError) {
        console.error("briefs-save update error:", updateError);
        return internalError("Failed to update brief");
      }

      if (!updated) {
        return notFound("Brief not found");
      }

      return new Response(JSON.stringify({ brief: updated }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Insert new brief
    const { data: inserted, error: insertError } = await client
      .from("briefs")
      .insert({ ...fields, user_id: user.id })
      .select("*")
      .single();

    if (insertError) {
      console.error("briefs-save insert error:", insertError);
      return internalError("Failed to create brief");
    }

    return new Response(JSON.stringify({ brief: inserted }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return internalError("Internal Server Error");
  }
});
