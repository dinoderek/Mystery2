/**
 * The ways an evaluation command fails before it judges anything. Each means
 * the run broke (exit code 1); the dispatcher prints the message without a
 * stack trace, because the message alone says what to fix.
 */

/** The command line is wrong: an unknown flag, a missing argument. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** The config file is wrong, or names a binding that cannot run. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** A file the command was pointed at is missing, or is not what it should be. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/**
 * The model login's usage limit is reached (`usage-limit.ts`). No retry or
 * other call would succeed before it resets, and the failure is not the call's,
 * so the runner throws this instead of recording a failed call, and a harness
 * lets it through rather than storing a judge's `error`.
 */
export class UsageLimitError extends Error {
  /** What the CLI said, as it said it. */
  readonly said: string;

  constructor(binding: string, said: string) {
    super(`the model login's usage limit is reached (binding "${binding}" was told: ${said})`);
    this.name = "UsageLimitError";
    this.said = said;
  }
}
