export interface RequestLogger {
  requestId: string;
  log: (event: string, details?: Record<string, unknown>) => void;
  logError: (event: string, details?: Record<string, unknown>) => void;
}

function resolveRequestId(req: Request): string {
  const headerRequestId = req.headers.get("x-request-id")?.trim();
  return headerRequestId && headerRequestId.length > 0
    ? headerRequestId
    : crypto.randomUUID();
}

function basePayload(
  endpoint: string,
  requestId: string,
  event: string,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    event,
    endpoint,
    request_id: requestId,
    ...(details ?? {}),
  };
}

export function createRequestLogger(req: Request, endpoint: string): RequestLogger {
  const requestId = resolveRequestId(req);

  return {
    requestId,
    log(event, details) {
      console.log(JSON.stringify(basePayload(endpoint, requestId, event, details)));
    },
    logError(event, details) {
      console.error(JSON.stringify(basePayload(endpoint, requestId, event, details)));
    },
  };
}
