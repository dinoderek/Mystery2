// A game server of a test's own, beside the suite's.
//
// The suite's server runs on a config root with no `ai.json`, and a server
// reads that file only when it starts. A test that needs a server started with
// AIs of its own, or one whose start must fail, starts it here, on the build the
// suite already made (building again would replace the files the suite's server
// runs from) and a free port. It is mock-only in the same way as the suite's.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { openDatabase, type Db } from '../../../packages/game-engine/src/db/client.ts';
import { playerCookieName } from '../../../packages/game-engine/src/player-cookie.ts';
import { startTestServer } from '../../../scripts/lib/test-server.mjs';
import type { TestPlayer } from './server';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const MOCK_ONLY_ENV = {
	OPENROUTER_URL: 'http://127.0.0.1:9/unreachable',
	CLAUDE_CLI_PATH: '/nonexistent/claude-cli-disabled-in-mock-tests',
	AI_CALL_LOG: '',
};

export interface OwnServer {
	apiUrl: string;
	databaseFile: string;
	createPlayer(tag: string): Promise<TestPlayer>;
	/** The server's database, opened once and closed by `stop()`. */
	database(): Db;
	stop(): Promise<void>;
}

export interface OwnServerOptions {
	/** Written as the root's `ai.json` before the server starts; a string is written as is. */
	aiConfig?: unknown;
	/** Given the config root before the server starts, after `aiConfig` is written. */
	seed?: (configRoot: string) => void;
	env?: Record<string, string>;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

/** Starts the server. Rejects when it exits during start, as a bad `ai.json` makes it. */
export async function startOwnServer({ aiConfig, seed: callerSeed, env = {} }: OwnServerOptions = {}): Promise<OwnServer> {
	const seed =
		aiConfig === undefined && callerSeed === undefined
			? undefined
			: (configRoot: string) => {
					if (aiConfig !== undefined) {
						fs.writeFileSync(
							path.join(configRoot, 'ai.json'),
							typeof aiConfig === 'string' ? aiConfig : JSON.stringify(aiConfig),
						);
					}
					callerSeed?.(configRoot);
				};
	const server = await startTestServer({
		repoRoot: REPO_ROOT,
		port: await freePort(),
		env: { ...MOCK_ONLY_ENV, ...env },
		build: false,
		seed,
	});
	const apiUrl = `${server.url}/api`;
	let db: Db | null = null;

	return {
		apiUrl,
		databaseFile: server.databaseFile,
		async createPlayer(tag) {
			const name = `${tag}-${crypto.randomUUID().slice(0, 8)}`;
			const response = await fetch(`${apiUrl}/player`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			if (!response.ok) throw new Error(`Failed to create test profile ${name}: ${response.status}`);
			const { player } = (await response.json()) as { player: { id: string; name: string } };
			return {
				id: player.id,
				name: player.name,
				headers: {
					'Content-Type': 'application/json',
					Cookie: `${playerCookieName(server.databaseFile)}=${player.id}`,
				},
			};
		},
		database() {
			db ??= openDatabase({ path: server.databaseFile });
			return db;
		},
		async stop() {
			db?.close();
			await server.stop();
		},
	};
}
