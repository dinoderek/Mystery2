import fs from "node:fs/promises";
import process from "node:process";
import { z } from "zod";
import { validateClueGraph } from "../../packages/shared/src/clue-graph-validator.ts";
import { parseDocument } from "./json-document.mjs";

/**
 * The command line the clue-graph commands share: `<command> <case.json>`.
 * Exit 0 on success, 1 on an invalid case (each issue on stderr), 2 on an
 * unreadable file, 3 on misuse. `print` gets the validated case and returns
 * the text for stdout.
 *
 * @param {string} name the command's name, for its usage line
 * @param {string[]} args the arguments after the command
 * @param {(graph: import("../../packages/shared/src/clue-graph-schema.ts").ClueGraphCase, file: string) => string} print
 */
export async function runClueGraphCommand(name, args, print) {
  const [file, ...extra] = args;
  if (!file || extra.length > 0) {
    process.stderr.write(`usage: ${name} <case.json>\n`);
    process.exitCode = 3;
    return;
  }
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(file));
    process.stdout.write(print(validateClueGraph(parseDocument(raw)), file));
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) process.stderr.write(`${JSON.stringify(issue.path)}: ${issue.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`${file}: ${error.message}\n`);
      process.exitCode = 2;
    }
  }
}
