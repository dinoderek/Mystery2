/**
 * `./dev eval label <game>`: serves the labelling page for one stored game of
 * the truth set until stopped (`evaluation/truth/README.md`, "Labels").
 *
 * It calls no model. `<game>` is the id of a stored game, the name of its
 * folder under `games/`; `--truth` names another truth set.
 */

import os from "node:os";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { TRUTH_ROOT } from "../lib/truth/loader.ts";
import { startLabelServer } from "./server.ts";
import type { LabelServer } from "./server.ts";

const HELP = formatHelp({
  usage: "label <game>",
  summary:
    "Serves a local page, on the loopback address only, that shows one turn of a stored game at a time and\n" +
    "saves what you find wrong in it into the game's labels.json. Pass 1 shows no judge finding. Pass 2 needs\n" +
    "stored results and shows only the turns where a judge and your label disagree. Stop it with Ctrl-C.",
  options: [
    ["--pass <1|2>", "which pass to label (default 1)"],
    ["--by <name>", "who gives the labels, as each label records it (default: your login name)"],
    ["--truth <folder>", "the truth set (default: evaluation/truth)"],
    ["--port <n>", "the port to listen on (default: any free one)"],
  ],
});

function pickPass(value: unknown): 1 | 2 {
  if (value === undefined || value === "1") return 1;
  if (value === "2") return 2;
  throw new UsageError(`--pass takes 1 or 2, not "${String(value)}"`);
}

function pickPort(value: unknown): number {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port takes a number from 0 to 65535, not "${String(value)}"`);
  return port;
}

function pickText(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new UsageError(`${flag} needs a value`);
  return value.trim();
}

/** Resolves when the person stops the command with Ctrl-C. */
export function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** The command, with the way it is told to stop; a test passes its own. */
export function createLabelCommand(waitToStop: (server: LabelServer) => Promise<void>): EvalCommand {
  return {
    name: "label",
    summary: "Label the turns of a stored game on a local page",
    help: HELP,
    async run(argv, context) {
      const { values, positionals } = parseCommandArgs(argv, {
        options: { pass: { type: "string" }, by: { type: "string" }, truth: { type: "string" }, port: { type: "string" } },
        positionals: { min: 1, max: 1 },
      });
      const pass = pickPass(values.pass);
      const by = pickText(values.by, "--by") ?? os.userInfo().username;
      const truth = pickText(values.truth, "--truth");
      const server = await startLabelServer({
        truthRoot: truth ? path.resolve(truth) : path.join(context.root, TRUTH_ROOT),
        game: positionals[0],
        pass,
        by,
        port: pickPort(values.port),
        log: context.err,
      });
      context.out(`Labelling ${positionals[0]}, pass ${pass}, as ${by}.\nOpen ${server.url}\nCtrl-C stops it.`);
      try {
        await waitToStop(server);
      } finally {
        await server.close();
      }
      return 0;
    },
  };
}

export const labelCommand = createLabelCommand(() => waitForInterrupt());
