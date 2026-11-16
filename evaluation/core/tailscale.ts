/**
 * This machine's name on its tailnet, for a local page `tailscale serve`
 * forwards to (`evaluation/label/README.md`). It starts the Tailscale command
 * line, here with the core's other subprocesses, and calls no model.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { InputError } from "./errors.ts";

/** Where the Tailscale command line may be: on the path, or inside the macOS app. */
const TAILSCALE_COMMANDS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

/** This machine's name on its tailnet, from `tailscale status --json`; throws `InputError` saying why it has none. */
export async function tailscaleName(run: (command: string, args: string[]) => Promise<string> = defaultRun): Promise<string> {
  const failures: string[] = [];
  for (const command of TAILSCALE_COMMANDS) {
    let output: string;
    try {
      output = await run(command, ["status", "--json"]);
    } catch (error) {
      failures.push(`${command}: ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    let name: unknown;
    try {
      name = (JSON.parse(output) as { Self?: { DNSName?: unknown } }).Self?.DNSName;
    } catch {
      throw new InputError(`${command} status --json did not answer JSON`);
    }
    if (typeof name !== "string" || name.replace(/\.$/, "") === "") throw new InputError(`${command} status --json names no tailnet name for this machine: is it signed in?`);
    return name.replace(/\.$/, "");
  }
  throw new InputError(`--tailscale could not ask Tailscale for this machine's name (${failures.join("; ")}); is Tailscale installed and running?`);
}

async function defaultRun(command: string, args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, { timeout: 10_000 });
  return stdout;
}
