/**
 * Replays cases through the game server, on a throwaway server of the
 * harness's own.
 *
 * The first replay builds the app and starts it on a free port against a
 * temporary config root (`scripts/lib/test-server.mjs`, which self-play uses
 * too), and the fixed history of each case is seeded into that root's
 * database. Nothing here opens, or even names, the database a person plays on;
 * `stop()` shuts the server down and removes its root.
 *
 * A server resolves a profile the way it always does. The temporary root holds
 * no `ai.json`, so the operator's, and the `.env.local` its keys may fall back
 * to, are linked in before the server starts (links, so a key stays in its own
 * file). `default` resolves to mock: the root's database is fresh.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { signIn } from "../../playtest/lib/api.ts";
import { startTestServer } from "../../../scripts/lib/test-server.mjs";
import { getAIConfigPath, getBaseEnvPath } from "../../../scripts/local-config.mjs";
import type { BlueprintLike, TurnCase } from "./case.ts";
import type { Collected } from "./replay-cli.ts";
import { getAction } from "./roles.ts";
import { seedSessionWithHistory } from "./seed.ts";
import { assertTurnPlayed, extractNarrationParts, makeResponse } from "./transcript.ts";

export interface ThrowawayServer {
  url: string;
  /** The temporary config root the server and its database live in. */
  configRoot: string;
  /** The database file inside it. */
  databaseFile: string;
  stop(): Promise<void>;
}

export interface StartServerOptions {
  repoRoot: string;
  port: number;
  env?: Record<string, string>;
  /** Given the config root before the server starts, to put files it reads at start there. */
  seed?: (configRoot: string) => void;
}

export type StartServer = (options: StartServerOptions) => Promise<ThrowawayServer>;

/** Builds the app and starts it against a temporary config root. */
export const startThrowawayServer: StartServer = (options) => startTestServer(options) as Promise<ThrowawayServer>;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Links `source` at `target` when `source` exists and `target` does not. */
function link(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target);
}

export interface ServerNarratorOptions {
  repoRoot: string;
  start?: StartServer;
  /** The environment profiles are read from, the operator's. */
  env?: NodeJS.ProcessEnv;
}

export interface ServerReplayRequest {
  testCase: TurnCase;
  blueprint: BlueprintLike;
  /** Where the blueprint file is, so the server can be given it. */
  blueprintPath: string;
  aiProfile: string;
}

/** The throwaway server, started on first use and shared by every case of a run. */
export class ServerNarrator {
  private readonly repoRoot: string;
  private readonly start: StartServer;
  private readonly env: NodeJS.ProcessEnv;
  private server: Promise<ThrowawayServer> | null = null;

  constructor({ repoRoot, start = startThrowawayServer, env = process.env }: ServerNarratorOptions) {
    this.repoRoot = repoRoot;
    this.start = start;
    this.env = env;
  }

  private ensureServer(): Promise<ThrowawayServer> {
    this.server ??= freePort().then((port) =>
      this.start({ repoRoot: this.repoRoot, port, seed: (configRoot) => this.linkAIs(configRoot) }),
    );
    return this.server;
  }

  /** Links the operator's AIs into the server's root: the server reads them only at start. */
  private linkAIs(configRoot: string): void {
    const inRoot = { MYSTERY_CONFIG_ROOT: configRoot };
    link(getAIConfigPath(this.repoRoot, this.env), getAIConfigPath(this.repoRoot, inRoot));
    // An entry without a key of its own falls back to the base file's.
    link(getBaseEnvPath(this.repoRoot, this.env), getBaseEnvPath(this.repoRoot, inRoot));
  }

  /** Makes the case's blueprint available to the server, if it is not the repo's. */
  private prepare(server: ThrowawayServer, request: ServerReplayRequest): void {
    const repoBlueprints = path.join(this.repoRoot, "blueprints");
    if (path.dirname(request.blueprintPath) !== repoBlueprints) {
      const dir = path.join(server.configRoot, "blueprints");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(request.blueprintPath, path.join(dir, path.basename(request.blueprintPath)));
    }
  }

  async replay(request: ServerReplayRequest): Promise<Collected> {
    const { testCase, blueprint, aiProfile } = request;
    const action = getAction(testCase.action.type);
    if (testCase.action.accusation_history_mode) {
      // A typed line cannot carry it; only the CLI narrators honour it.
      throw new Error("accusation_history_mode is not supported by the server narrator");
    }
    const server = await this.ensureServer();
    this.prepare(server, request);

    const playerName = `runtime-eval-${randomUUID().slice(0, 8)}`;
    const api = await signIn(server.url, playerName);
    // `start` creates its own session, so there is nothing to seed and no game
    // id to address; every other action acts on a fully specified seeded one.
    const gameId = action.createsSession
      ? null
      : seedSessionWithHistory({ databaseFile: server.databaseFile, blueprint, given: testCase.given, aiProfile, playerName });

    const body = action.endpoint.body(testCase.given, testCase.action, gameId, { blueprint, aiProfile });
    const answer = await api.post<Record<string, unknown>>(action.endpoint.name, body);
    if (!answer.ok) {
      throw new Error(`${action.endpoint.name} failed: HTTP ${answer.status} ${JSON.stringify(answer.body).slice(0, 500)}`);
    }
    if (action.endpoint.name === "game-turn") assertTurnPlayed(answer.body, String(body.input), action);

    const response = makeResponse({
      action: testCase.action.type,
      request: body,
      parts: extractNarrationParts(testCase.action.type, answer.body),
      raw: answer.body,
    });
    return { response, model: aiProfile, call: null };
  }

  /** Stops the server, if one was started, and removes its config root. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    // A server that never started has nothing to stop, and cleaned up its own root.
    const started = await server?.catch(() => null);
    if (started) await started.stop();
  }
}
