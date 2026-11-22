#!/usr/bin/env node
// Prints a clue-graph case's graph as Markdown trails (`docs/clue-graph.md`).
// Never runs a model.
import process from "node:process";
import { runClueGraphCommand } from "./lib/clue-graph-cli.mjs";
import { clueGraphTrails } from "../packages/shared/src/clue-graph-trails.ts";

await runClueGraphCommand("print-clue-graph-trails.mjs", process.argv.slice(2), (graph) => clueGraphTrails(graph));
