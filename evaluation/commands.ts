/**
 * The commands `./dev eval` knows, in the order it lists them. A command is an
 * `EvalCommand` (`core/dispatch.ts`); adding one is an entry here.
 */

import { judgeBlueprintCommand, validateCommand } from "./blueprint/commands.ts";
import type { EvalCommand } from "./core/dispatch.ts";
import { baselineCompareCommand, baselineSaveCommand, baselineStatusCommand } from "./runtime/baseline.ts";
import { casesCommand } from "./runtime/cases.ts";
import { playCommand } from "./playtest/play.ts";
import { reportCommand } from "./playtest/report.ts";
import { judgeTurnCommand } from "./runtime/judge-turn.ts";
import { perfPushCommand } from "./perf/push.ts";
import { perfSyncCommand } from "./perf/sync.ts";
import { judgeGame } from "./trace/judge-game.ts";

export const COMMANDS: readonly EvalCommand[] = [
  judgeBlueprintCommand,
  validateCommand,
  judgeGame,
  judgeTurnCommand,
  casesCommand,
  baselineSaveCommand,
  baselineCompareCommand,
  baselineStatusCommand,
  perfPushCommand,
  perfSyncCommand,
  playCommand,
  reportCommand,
];
