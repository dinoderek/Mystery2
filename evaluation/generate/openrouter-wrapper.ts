/**
 * The entry the `generator-api` wrapper script starts: `node
 * openrouter-wrapper.ts <system prompt file> <user message file>`. The system
 * prompt file is not read; the request builds the same prompt from the brief
 * (`openrouter.ts`).
 */

import process from "node:process";

import { describeFailure, generateViaOpenRouter } from "./openrouter.ts";

const userMessageFile = process.argv[3];
if (!userMessageFile) {
  process.stderr.write("usage: openrouter-wrapper.ts <system prompt file> <user message file>\n");
  process.exit(2);
}
try {
  process.stdout.write(await generateViaOpenRouter({ userMessageFile, env: process.env }));
} catch (error) {
  process.stderr.write(`openrouter-generate: ${describeFailure(error)}\n`);
  process.exit(1);
}
