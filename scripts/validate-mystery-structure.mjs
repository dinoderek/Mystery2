#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import { z } from "zod";
import { parseDocument } from "./lib/json-document.mjs";
import { validateMysteryStructure } from "../packages/shared/src/mystery-structure-validator.ts";

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length > 0) {
  process.stderr.write(
    "usage: validate-mystery-structure.mjs <mystery.json>\n",
  );
  process.exitCode = 3;
} else {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(
      await fs.readFile(file),
    );
    const mystery = validateMysteryStructure(parseDocument(raw));
    process.stdout.write(
      `OK: ${file} (Mystery Structure ${mystery.$specVersion}, revision ${mystery.metadata.revision})\n`,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues)
        process.stderr.write(
          `${JSON.stringify(issue.path)}: ${issue.message}\n`,
        );
      process.exitCode = 1;
    } else {
      process.stderr.write(`${file}: ${error.message}\n`);
      process.exitCode = 2;
    }
  }
}
