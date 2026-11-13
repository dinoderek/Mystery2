export interface ErrorDetails {
  retriable?: boolean;
  code?: string;
  [key: string]: unknown;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonError(
  status: number,
  error: string,
  details?: ErrorDetails,
): Response {
  return new Response(
    JSON.stringify(details ? { error, details } : { error }),
    { status, headers: JSON_HEADERS },
  );
}

export function badRequest(msg: string, details?: ErrorDetails): Response {
  return jsonError(400, msg, details);
}

export function notFound(msg: string, details?: ErrorDetails): Response {
  return jsonError(404, msg, details);
}

export function internalError(msg: string, details?: ErrorDetails): Response {
  return jsonError(500, msg, details);
}

export function conflict(msg: string, details?: ErrorDetails): Response {
  return jsonError(409, msg, details);
}

export function aiRetriableError(
  msg = "AI request failed; safe to retry",
  details?: ErrorDetails,
): Response {
  return jsonError(503, msg, {
    retriable: true,
    code: "AI_TEMPORARY_FAILURE",
    ...details,
  });
}

export function asRetriableAIResponse(error: unknown): Response | null {
  if (error instanceof RetriableAIError) {
    return aiRetriableError(error.message, error.details);
  }
  return null;
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class RetriableAIError extends Error {
  readonly details: ErrorDetails;

  constructor(message: string, details?: ErrorDetails) {
    super(message);
    this.name = "RetriableAIError";
    this.details = {
      retriable: true,
      code: "AI_TEMPORARY_FAILURE",
      ...details,
    };
  }
}

/**
 * A save found the game's events no longer end where the turn expected: another
 * write for the same game got there first, and nothing was written.
 */
export class SaveConflictError extends Error {
  readonly gameId: string;
  readonly expectedSequence: number;

  constructor(gameId: string, expectedSequence: number) {
    super(
      `Game ${gameId} changed while this turn was in progress ` +
        `(expected to write sequence ${expectedSequence})`,
    );
    this.name = "SaveConflictError";
    this.gameId = gameId;
    this.expectedSequence = expectedSequence;
  }
}

export function asConflictResponse(error: unknown): Response | null {
  return error instanceof SaveConflictError
    ? conflict(error.message, { code: "SAVE_CONFLICT" })
    : null;
}
