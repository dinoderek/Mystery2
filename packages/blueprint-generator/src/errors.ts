export type BlueprintGenerationErrorCode = "INVALID_STORY_BRIEF" | "PROMPT_LOAD_FAILED";

export interface BlueprintGenerationErrorDetails {
  issues?: unknown;
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
