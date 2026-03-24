export type BlueprintGenerationErrorCode =
  | "INVALID_STORY_BRIEF"
  | "PROMPT_LOAD_FAILED"
  | "OPENROUTER_ERROR"
  | "UNSUPPORTED_STRUCTURED_OUTPUTS"
  | "INVALID_JSON_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED";

export interface BlueprintGenerationErrorDetails {
  status?: number;
  responseBody?: string;
  responseText?: string;
  issues?: unknown;
  model?: string;
  outputPath?: string;
  requestBody?: Record<string, unknown>;
}

export class BlueprintGenerationError extends Error {
  readonly code: BlueprintGenerationErrorCode;
  readonly details: BlueprintGenerationErrorDetails;

  constructor(
    code: BlueprintGenerationErrorCode,
    message: string,
    details: BlueprintGenerationErrorDetails = {},
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BlueprintGenerationError";
    this.code = code;
    this.details = details;
  }
}
