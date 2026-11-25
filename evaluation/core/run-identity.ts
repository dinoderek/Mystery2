/**
 * Who ran what, for the `run` block of every result: the suite and label a run
 * was given, the developer and host, and the run a run belongs to. Prompt
 * versions are read where the run folder is made (`prompt-versions.ts`).
 */

import os from "node:os";

import type { CommonArgs } from "./args.ts";
import { configuredDeveloper } from "./config.ts";

/** What the run commands pass `createRunFolder` to record. */
export interface RunIdentity {
  suite: string | null;
  label: string | null;
  developer: string | null;
  /** The id of the run this run belongs to, as `judge game` started by `play --judge` records it. */
  parent_run: string | null;
}

/** The OS user name: what a run records when the config names no developer. Never an email address. */
export function osUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}

/** The identity of a run started with `common`, from the config it reads, else the OS user. */
export function runIdentity(
  common: Pick<CommonArgs, "suite" | "label" | "configPath">,
  root: string,
  parentRun: string | null = null,
): RunIdentity {
  return {
    suite: common.suite,
    label: common.label,
    developer: configuredDeveloper({ root, configPath: common.configPath }) ?? osUserName(),
    parent_run: parentRun,
  };
}
