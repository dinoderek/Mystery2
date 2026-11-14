/**
 * The commands `./dev eval` knows, in the order it lists them. A command is an
 * `EvalCommand` (`core/dispatch.ts`); adding one is an entry here.
 */

import { judgeBlueprintCommand, validateCommand } from "./blueprint/commands.ts";
import type { EvalCommand } from "./core/dispatch.ts";
import { generateCommand } from "./generate/commands.ts";
import { judgeGame } from "./trace/judge-game.ts";

export const COMMANDS: readonly EvalCommand[] = [generateCommand, judgeBlueprintCommand, validateCommand, judgeGame];
