export function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export function internalError(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}
