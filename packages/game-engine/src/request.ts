// Checking a request against its shared schema. An endpoint that takes fields
// reads them here and answers a bad request with `400`, naming the field in the
// message and in `details.field` (`null` when the body is not JSON at all).

import type { ZodType, ZodTypeDef } from "zod";

import { badRequest } from "./errors.ts";
import type { LogWriter } from "./logging.ts";

export type ReadRequest<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

function rejected(
  message: string,
  field: string | null,
  logger: LogWriter,
): { ok: false; response: Response } {
  logger.log("request.invalid", { reason: "invalid_request", field });
  return { ok: false, response: badRequest(message, { field }) };
}

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown, logger: LogWriter): ReadRequest<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  const field = issue.path.join(".") || null;
  return rejected(`Invalid ${field ?? "request"}: ${issue.message}`, field, logger);
}

/** The JSON body of a `POST`, checked against `schema`. */
export async function readJsonRequest<T>(
  req: Request,
  schema: ZodType<T, ZodTypeDef, unknown>,
  logger: LogWriter,
): Promise<ReadRequest<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rejected("Request body must be JSON", null, logger);
  }
  return parse(schema, body, logger);
}

/** The query string of a `GET`, checked against `schema`. A missing parameter reads as absent. */
export function readQueryRequest<T>(
  req: Request,
  schema: ZodType<T, ZodTypeDef, unknown>,
  logger: LogWriter,
): ReadRequest<T> {
  const params = new URL(req.url).searchParams;
  return parse(schema, Object.fromEntries(params.entries()), logger);
}
