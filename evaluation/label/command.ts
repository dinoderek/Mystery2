/**
 * `./dev eval label [<game>]`: serves the labelling page over the stored games
 * of the truth set until stopped (`evaluation/label/README.md`).
 *
 * It calls no model. With `<game>` it prints the address of that game's pass;
 * without, the list of games. `--tailscale` lets the machine's tailnet name
 * reach it through `tailscale serve`.
 */

import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { tailscaleName } from "../core/tailscale.ts";
import { TRUTH_ROOT } from "../lib/truth/loader.ts";
import { PHASE_NAMES, phasePath } from "./hub.ts";
import type { Phase } from "./hub.ts";
import { checkName, startLabelServer } from "./server.ts";
import type { LabelServer } from "./server.ts";

const HELP = formatHelp({
  usage: "label [<game>]",
  summary:
    "Serves a local page, on the loopback address only, over every stored game of the truth set: search the\n" +
    "games by name, stage and date, pick a pass, and label one turn at a time into the game's labels.json.\n" +
    "Pass 1 shows no judge finding. Pass 2 needs stored results and shows only the turns where a judge and\n" +
    "the label disagree. Reported turns are pass 1 limited to the turns a failing verdict's finding points\n" +
    "at. Each visitor picks the name their labels record. With <game>, it prints that game's pass. Stop it\n" +
    "with Ctrl-C.",
  options: [
    ["--pass <1|2>", "with <game>: which pass to open (default 1)"],
    ["--reported", "with <game>: pass 1, just the turns a failing verdict's finding points at"],
    ["--by <name>", "who labels until a visitor picks a name (default: each visitor is asked)"],
    ["--tailscale", "also answer to this machine's tailnet name, behind `tailscale serve`"],
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

export interface LabelCommandDeps {
  /** How the tailnet name is found; a test passes its own. */
  tailscaleName?: () => Promise<string>;
}

function phaseFor(pass: 1 | 2, reported: boolean): Phase {
  if (reported) return "reported";
  return pass === 2 ? "pass-2" : "pass-1";
}

/** The command, with the way it is told to stop; a test passes its own. */
export function createLabelCommand(waitToStop: (server: LabelServer) => Promise<void>, deps: LabelCommandDeps = {}): EvalCommand {
  return {
    name: "label",
    summary: "Label the turns of the stored games on a local page",
    help: HELP,
    async run(argv, context) {
      const { values, positionals } = parseCommandArgs(argv, {
        options: {
          pass: { type: "string" },
          reported: { type: "boolean" },
          by: { type: "string" },
          tailscale: { type: "boolean" },
          truth: { type: "string" },
          port: { type: "string" },
        },
        positionals: { min: 0, max: 1 },
      });
      const game = positionals[0] as string | undefined;
      const pass = pickPass(values.pass);
      const reported = values.reported === true;
      const port = pickPort(values.port);
      const truth = pickText(values.truth, "--truth");
      const byText = pickText(values.by, "--by");
      if (game === undefined && (values.pass !== undefined || reported)) throw new UsageError("--pass and --reported open a game's pass: name the game");
      if (reported && pass !== 1) throw new UsageError("--reported limits pass 1; pass 2 already shows only the turns where a judge and a label disagree");
      let by: string | undefined;
      try {
        by = byText === undefined ? undefined : checkName(byText);
      } catch (error) {
        throw new UsageError(`--by: ${(error as Error).message}`);
      }
      const hosts = values.tailscale === true ? [await (deps.tailscaleName ?? (() => tailscaleName()))()] : [];
      const server = await startLabelServer({ truthRoot: truth ? path.resolve(truth) : path.join(context.root, TRUTH_ROOT), by, hosts, port, log: context.err });
      try {
        const phase = phaseFor(pass, reported);
        // Refuses a game or a pass that is not there before printing an address for it.
        if (game !== undefined) server.hub.phase(game, phase);
        const start = game === undefined ? { path: "/", what: "the stored games" } : { path: `${phasePath(game, phase)}/`, what: `${game}, ${PHASE_NAMES[phase]}` };
        const lines = [`Labelling ${start.what}${by ? `, as ${by} until a visitor picks a name` : ""}.`, `Open ${new URL(start.path, server.url).href}`];
        if (hosts.length > 0) {
          lines.push(`On the tailnet, run \`tailscale serve --bg ${server.port}\` once, then open https://${hosts[0]}${start.path}`);
        }
        lines.push("Ctrl-C stops it.");
        context.out(lines.join("\n"));
        await waitToStop(server);
      } finally {
        await server.close();
      }
      return 0;
    },
  };
}

export const labelCommand = createLabelCommand(() => waitForInterrupt());
