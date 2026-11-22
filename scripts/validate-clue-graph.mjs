#!/usr/bin/env node
import process from "node:process";
import { runClueGraphCommand } from "./lib/clue-graph-cli.mjs";

await runClueGraphCommand("validate-clue-graph.mjs", process.argv.slice(2), (graph, file) =>
  `OK: ${file} (${graph.format}, ${Object.keys(graph.clues).length} clues, ${Object.keys(graph.conclusions).length} conclusions)\n`,
);
