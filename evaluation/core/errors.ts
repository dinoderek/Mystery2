/**
 * The two ways an evaluation command fails before it judges anything. Both
 * mean the run broke (exit code 1); the dispatcher prints the message without
 * a stack trace, because the message alone says what to fix.
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
