const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function mergeCorsHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }

  return merged;
}

function withCorsHeaders(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergeCorsHeaders(response.headers),
  });
}

export function serveWithCors(
  handler: (req: Request) => Response | Promise<Response>,
): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: mergeCorsHeaders() });
    }

    const response = await handler(req);
    return withCorsHeaders(response);
  });
}
