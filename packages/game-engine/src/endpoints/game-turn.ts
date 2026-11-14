// game-turn: plays one typed line. The adapter checks the request against the
// shared contract, calls the turn function, and maps what it throws to a status.

import { GameTurnRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import type { EngineContext } from "../context.ts";
import {
  asConflictResponse,
  asRejectedResponse,
  asRetriableAIResponse,
  badRequest,
  BadRequestError,
  internalError,
  RequestRejectedError,
  RetriableAIError,
  SaveConflictError,
} from "../errors.ts";
import { createRequestLogger, withLogContext, type LogWriter } from "../logging.ts";
import { playTurn } from "../turn/play-turn.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function readRequest(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: badRequest("Request body must be JSON", { field: null }) };
  }
  const parsed = GameTurnRequestSchema.safeParse(body);
  if (parsed.success) return { request: parsed.data };

  const issue = parsed.error.issues[0];
  const field = issue.path.join(".") || null;
  return { error: badRequest(`Invalid ${field ?? "request"}: ${issue.message}`, { field }) };
}

function errorResponse(error: unknown, logger: LogWriter): Response {
  if (error instanceof RequestRejectedError) {
    if (error.status === 500) logger.logError("request.error", { reason: error.reason });
    else logger.log("request.invalid", { reason: error.reason });
    return asRejectedResponse(error)!;
  }
  if (error instanceof BadRequestError) {
    logger.log("request.invalid", { reason: "bad_request_error", message: error.message });
    return badRequest(error.message);
  }
  if (error instanceof SaveConflictError) {
    logger.log("request.conflict", { error: error.message });
    return asConflictResponse(error)!;
  }
  // The narrator's failures were logged where they happened.
  if (error instanceof RetriableAIError) return asRetriableAIResponse(error)!;
  logger.logError("request.unhandled_error", { error: error instanceof Error ? error.message : String(error) });
  return internalError("Internal Server Error");
}

export async function handle(req: Request, ctx: EngineContext): Promise<Response> {
  const logger = createRequestLogger(req, "game-turn");

  const { request, error } = await readRequest(req);
  if (!request) {
    logger.log("request.invalid", { reason: "invalid_request" });
    return error;
  }

  const gameLogger = withLogContext(logger, { game_id: request.game_id });
  try {
    const answer = await playTurn(ctx, request, { req, request_id: logger.requestId, logger: gameLogger });
    return new Response(JSON.stringify(answer), { headers: JSON_HEADERS });
  } catch (caught) {
    return errorResponse(caught, gameLogger);
  }
}
