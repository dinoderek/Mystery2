// Talking to the game server a test run started.
//
// `scripts/run-mock-tests.mjs` builds the app, starts it against a temporary
// config root, and passes both down through the environment. Everything here
// reads those two values; nothing here starts or stops anything.
//
// What this replaces: creating an auth user through the admin API, signing it
// in for a JWT, and a service-role client for direct-database assertions. A
// player is now a name, a session is a cookie, and the database is a file the
// test can open.

import fs from 'node:fs';
import path from 'node:path';

import { openDatabase, type Db } from '../../../packages/game-engine/src/db/client.ts';

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is not set. Run the suite through \`npm run test:integration\` / ` +
				'`npm run test:e2e`, which start the server and set it.',
		);
	}
	return value;
}

/** Origin of the server under test, e.g. `http://127.0.0.1:51006`. */
export const BASE_URL = required('MYSTERY_TEST_API_URL');

/** Where the run's disposable database and images live. */
export const TEST_CONFIG_ROOT = required('MYSTERY_TEST_CONFIG_ROOT');

/** The game API, e.g. `http://127.0.0.1:51006/api`. */
export const API_URL = `${BASE_URL}/api`;

export interface TestPlayer {
	id: string;
	name: string;
	/** Headers that authenticate as this profile and send JSON. */
	headers: Record<string, string>;
}

/**
 * Creates a fresh local profile and returns the headers that act as it.
 *
 * There is nothing to clean up afterwards: the whole database is deleted with
 * the config root when the run ends.
 */
export async function createTestPlayer(tag: string): Promise<TestPlayer> {
	const name = `${tag}-${crypto.randomUUID().slice(0, 8)}`;
	const response = await fetch(`${API_URL}/player`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});

	if (!response.ok) {
		throw new Error(`Failed to create test profile ${name}: ${response.status}`);
	}

	const { player } = (await response.json()) as { player: { id: string; name: string } };

	return {
		id: player.id,
		name: player.name,
		headers: {
			'Content-Type': 'application/json',
			Cookie: `mystery-player-id=${player.id}`,
		},
	};
}

let database: Db | null = null;

/**
 * The run's database, for assertions the API does not expose.
 *
 * The server holds it open at the same time; that is what `journal_mode = WAL`
 * is for. Read through this, do not write.
 */
export function testDatabase(): Db {
	database ??= openDatabase({ path: path.join(TEST_CONFIG_ROOT, 'game.db') });
	return database;
}

/** A minimal valid 1x1 transparent PNG. */
export const STUB_PNG = new Uint8Array([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
	0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 98, 0, 0, 0, 2, 0, 1, 226,
	33, 188, 51, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/**
 * Puts an image where the server serves it from. Images are stored flat, named
 * by image id — the same layout the generator writes.
 */
export function seedTestImage(imageId: string, bytes: Uint8Array = STUB_PNG): void {
	const dir = path.join(TEST_CONFIG_ROOT, 'blueprint-images');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, imageId), bytes);
}

/** Takes an image away again, for the case where a blueprint names a file nobody generated. */
export function removeTestImage(imageId: string): void {
	fs.rmSync(path.join(TEST_CONFIG_ROOT, 'blueprint-images', imageId), { force: true });
}
