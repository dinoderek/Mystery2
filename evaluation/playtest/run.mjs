#!/usr/bin/env node
// Playtest harness — entrypoint.
//
//   npm run eval:playtest -- --blueprint the-missing-heartwood [options]
//
// Starts the game against a throwaway database, then plays whole games with an
// AI investigator (a `claude` call per turn, playing a persona) while the game
// narrates through the claude CLI. Each game gets a folder: a readable
// transcript, the investigator's inputs as a script for replay, every step and
// every narrator call. See evaluation/playtest/README.md.
//
// Options:
//   --blueprint <x>           a blueprint id, file name, title, or path to a JSON file
//   --persona <name>          a file in personas/ (default: detective)
//   --games <n>               games to play (default: 1)
//   --concurrency <n>         games at once (default: 2)
//   --max-steps <n>           investigator inputs per game before giving up (default: 60)
//   --narrator <claude|mock>  the game's narrator (default: claude)
//   --narrator-model <m>      default: sonnet
//   --investigator-model <m>  default: sonnet
//   --out <dir>               runs root (default: evaluation/playtest/runs)
//   --port <n>                server port (default: a free one)
//
// Blueprints are looked up in the repo's blueprints/ only; one generated into
// your config root is named by its path.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import Database from "better-sqlite3";

import { TEST_DATABASE, resolveDatabaseFile } from "../../lib/database-target.mjs";
import { startTestServer } from "../../scripts/lib/test-server.mjs";
import { signIn } from "./lib/api.mjs";
import { listPersonas, modelInvestigator } from "./lib/investigator.mjs";
import { writeGameFolder } from "./lib/output.mjs";
import { DEFAULT_MAX_STEPS, playGame } from "./lib/play.mjs";

const REPO_ROOT = process.cwd();
const REPO_BLUEPRINTS = path.join(REPO_ROOT, "blueprints");

function parseArgs(argv) {
  const args = {
    blueprint: null,
    persona: "detective",
    games: 1,
    concurrency: 2,
    maxSteps: DEFAULT_MAX_STEPS,
    narrator: "claude",
    narratorModel: "sonnet",
    investigatorModel: "sonnet",
    out: path.join(REPO_ROOT, "evaluation", "playtest", "runs"),
    port: null,
  };
  const numeric = new Set(["games", "concurrency", "maxSteps", "port"]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) usage(`Unexpected argument "${flag}"`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in args)) usage(`Unknown option ${flag}`);
    const value = argv[index + 1];
    if (value === undefined) usage(`${flag} needs a value`);
    index += 1;
    if (numeric.has(key)) {
      const number = Number.parseInt(value, 10);
      if (!Number.isInteger(number) || number < 1) usage(`${flag} needs a positive integer`);
      args[key] = number;
    } else {
      args[key] = value;
    }
  }

  if (!args.blueprint) usage("--blueprint is required");
  if (args.narrator !== "claude" && args.narrator !== "mock") {
    usage(`--narrator must be claude or mock`);
  }
  if (!listPersonas().includes(args.persona)) {
    usage(`Unknown persona "${args.persona}". Known: ${listPersonas().join(", ")}`);
  }
  return args;
}

function usage(message) {
  console.error(`${message}\n`);
  const header = fs.readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1)
    .filter((line) => line.startsWith("//"))
    .map((line) => line.replace(/^\/\/ ?/, ""));
  console.error(header.join("\n"));
  process.exit(1);
}

/** A blueprint by path, or by id, file name or title among the repo's. */
function findBlueprint(query) {
  if (fs.existsSync(query) && fs.statSync(query).isFile()) {
    return { file: path.resolve(query), blueprint: JSON.parse(fs.readFileSync(query, "utf8")) };
  }

  const wanted = query.toLowerCase().replace(/\.json$/, "");
  for (const name of fs.readdirSync(REPO_BLUEPRINTS).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(REPO_BLUEPRINTS, name);
    const blueprint = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      blueprint.id === query ||
      name.replace(/\.json$/, "").toLowerCase() === wanted ||
      blueprint.metadata?.title?.toLowerCase() === wanted
    ) {
      return { file, blueprint };
    }
  }
  usage(`No blueprint matches "${query}" (looked for a file, and in ${REPO_BLUEPRINTS}).`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const args = parseArgs(process.argv.slice(2));
const { file: blueprintFile, blueprint } = findBlueprint(args.blueprint);
const runDir = path.join(
  args.out,
  `${timestampSlug()}-${slug(blueprint.metadata.title)}-${args.persona}`,
);
const callLogFile = path.join(runDir, "ai-calls.all.jsonl");
const narratorModel = args.narrator === "mock" ? "mock" : args.narratorModel;

const narratorEnv = args.narrator === "mock"
  ? {
    AI_PROVIDER: "mock",
    AI_MODEL: "mock/runtime-default",
    OPENROUTER_URL: "http://127.0.0.1:9/unreachable",
    CLAUDE_CLI_PATH: "/nonexistent/claude-cli-disabled-for-mock-narrator",
  }
  : {
    AI_PROVIDER: "claude-cli",
    AI_MODEL: args.narratorModel,
    // Three attempts at 90s stay under the 300s a fetch waits for headers, so
    // a slow narrator turn fails as a turn instead of dropping the request.
    AI_CLAUDE_CLI_TIMEOUT_MS: "90000",
  };

console.log(`Playtest: ${blueprint.metadata.title} as "${args.persona}", ${args.games} game(s)`);
console.log(`Narrator: ${narratorModel}; investigator: ${args.investigatorModel}`);
console.log(`Run folder: ${path.relative(REPO_ROOT, runDir)}`);

async function playOne(number) {
  const started = Date.now();
  const api = await signIn(server.url, `playtest-${args.persona}-${number}`);
  const investigator = modelInvestigator({
    persona: args.persona,
    model: args.investigatorModel,
    binary: process.env.CLAUDE_CLI_PATH?.trim() || "claude",
  });
  const game = await playGame({
    api,
    blueprint: { id: blueprint.id, title: blueprint.metadata.title },
    investigator,
    maxSteps: args.maxSteps,
    onStep: (step) =>
      console.log(
        `[game ${number}] step ${step.step} (${step.mode_before}, ${step.time_before} left) > ${step.input}`,
      ),
  });
  const summary = writeGameFolder({
    dir: path.join(runDir, `game-${number}`),
    game,
    blueprint,
    persona: args.persona,
    narratorModel,
    investigatorModel: args.investigatorModel,
    callLogFile,
    wallMs: Date.now() - started,
  });
  console.log(
    `[game ${number}] ${summary.outcome ?? summary.stop_reason}: ${summary.clues_found}/${summary.clues_total} clues, ${summary.turns_used}/${summary.time_budget} turns`,
  );
  return summary;
}

const server = await startTestServer({
  repoRoot: REPO_ROOT,
  port: args.port ?? await freePort(),
  env: { ...narratorEnv, AI_CALL_LOG: callLogFile },
});

fs.mkdirSync(runDir, { recursive: true });
let summaries = [];
try {
  // A blueprint from outside the repo is dropped into the throwaway config
  // root; the server re-reads its blueprint folders on each request.
  if (path.dirname(blueprintFile) !== REPO_BLUEPRINTS) {
    const dir = path.join(server.configRoot, "blueprints");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(blueprintFile, path.join(dir, path.basename(blueprintFile)));
  }

  summaries = await mapWithConcurrency(
    Array.from({ length: args.games }, (_, index) => index + 1),
    args.concurrency,
    (number) => playOne(number).catch((error) => {
      // A game that could not be played at all (sign-in, game start) is
      // reported and the others carry on.
      console.error(`[game ${number}] failed: ${error.message}`);
      return { game: number, error: error.message };
    }),
  );
} finally {
  try {
    // Keep the database: a game can be graded or inspected later with
    // `eval:trace:extract --db <run>/game.db --session <game_id>`. The server's
    // config root stands in for the repo root here, with no environment, which
    // is how the server itself resolved it (<root>/database/test/game.db).
    const database = resolveDatabaseFile(TEST_DATABASE, server.configRoot, {});
    if (fs.existsSync(database)) {
      const source = new Database(database, { readonly: true });
      try {
        await source.backup(path.join(runDir, "game.db"));
      } finally {
        source.close();
      }
    }
  } finally {
    await server.stop();
  }
}

fs.writeFileSync(path.join(runDir, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`\nWrote ${path.relative(REPO_ROOT, runDir)}`);
