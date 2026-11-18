/**
 * The commands `./dev eval` knows, in the order it lists them. A command is an
 * `EvalCommand` (`core/dispatch.ts`); adding one is an entry here.
 */

import { judgeBlueprintCommand, validateCommand } from "./blueprint/commands.ts";
import type { EvalCommand } from "./core/dispatch.ts";
import { compareCommand } from "./compare/command.ts";
import { generateCommand } from "./generate/commands.ts";
import { scenesCommand } from "./generate/scenes.ts";
import { labelCommand } from "./label/command.ts";
import { casesCommand } from "./runtime/cases.ts";
import { playCommand } from "./playtest/play.ts";
import { reportCommand } from "./playtest/report.ts";
import { judgeTurnCommand } from "./runtime/judge-turn.ts";
import { scoreCommand } from "./score/command.ts";
import { suiteCommand } from "./suite/command.ts";
import { judgeGame } from "./trace/judge-game.ts";

export const COMMANDS: readonly EvalCommand[] = [
  generateCommand,
  scenesCommand,
  judgeBlueprintCommand,
  validateCommand,
  judgeGame,
  judgeTurnCommand,
  casesCommand,
  playCommand,
  reportCommand,
  labelCommand,
  scoreCommand,
  compareCommand,
  suiteCommand,
];
