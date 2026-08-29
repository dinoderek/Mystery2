import { createTestPlayer, testDatabase, type TestPlayer } from '../../testkit/src/server';

export {
	API_URL,
	BASE_URL,
	TEST_CONFIG_ROOT,
	removeTestImage,
	seedTestImage,
	testDatabase,
	STUB_PNG,
} from '../../testkit/src/server';

/** The deterministic fixture in `blueprints/mock-blueprint.json`. */
export const MOCK_BLUEPRINT_ID = '123e4567-e89b-12d3-a456-426614174000';

export type ApiAuthContext = TestPlayer;

/** A fresh local profile to run one test's requests as. */
export function setupApiTestAuth(tag: string): Promise<ApiAuthContext> {
	return createTestPlayer(tag);
}

// ---------------------------------------------------------------------------
// Reading the server's database directly
//
// For assertions the API does not expose (what was actually persisted) and
// for setting up states the API cannot reach (a session with one minute left).
// They replace the service-role client the suites used to keep around.
// ---------------------------------------------------------------------------

export interface StoredSession {
	mode: string;
	outcome: string | null;
	time_remaining: number;
	ai_profile_id: string;
	current_location_id: string;
	current_talk_character_id: string | null;
	discovered_clues: string[];
}

export function readStoredSession(gameId: string): StoredSession | null {
	const row = testDatabase()
		.prepare('select * from game_sessions where id = ?')
		.get(gameId);
	if (!row) return null;

	return {
		mode: String(row.mode),
		outcome: row.outcome === null ? null : String(row.outcome),
		time_remaining: Number(row.time_remaining),
		ai_profile_id: String(row.ai_profile_id),
		current_location_id: String(row.current_location_id),
		current_talk_character_id:
			row.current_talk_character_id === null ? null : String(row.current_talk_character_id),
		discovered_clues: JSON.parse(String(row.discovered_clues)) as string[],
	};
}

/** Columns a test may set directly. Anything else is a typo, not a fixture. */
const PATCHABLE = new Set([
	'blueprint_id',
	'mode',
	'outcome',
	'time_remaining',
	'current_location_id',
	'current_talk_character_id',
	'created_at',
	'updated_at',
]);

/**
 * Writes session columns the API will not set for you — an all-but-expired
 * clock, a session completed last Tuesday. The database is a file, so this is
 * a statement rather than a privileged client.
 */
export function patchStoredSession(
	gameId: string,
	patch: Record<string, string | number | null>,
): void {
	const columns = Object.keys(patch);
	for (const column of columns) {
		if (!PATCHABLE.has(column)) throw new Error(`Column "${column}" is not patchable`);
	}
	if (columns.length === 0) return;

	testDatabase()
		.prepare(
			`update game_sessions set ${columns.map((c) => `${c} = ?`).join(', ')} where id = ?`,
		)
		.run(...columns.map((c) => patch[c]), gameId);
}

/** Forces a session close to its time limit, which no endpoint will do. */
export function setStoredTimeRemaining(gameId: string, timeRemaining: number): void {
	patchStoredSession(gameId, { time_remaining: timeRemaining });
}

export interface StoredEvent {
	sequence: number;
	event_type: string;
	actor: string;
	narration: string;
	payload: Record<string, unknown> | null;
	narration_parts: Array<Record<string, unknown>>;
	model: string | null;
}

export function readStoredEvents(gameId: string): StoredEvent[] {
	return testDatabase()
		.prepare(
			`select sequence, event_type, actor, narration, payload, narration_parts, model
			   from game_events where session_id = ? order by sequence asc`,
		)
		.all(gameId)
		.map((row) => ({
			sequence: Number(row.sequence),
			event_type: String(row.event_type),
			actor: String(row.actor),
			narration: String(row.narration),
			payload: row.payload === null ? null : JSON.parse(String(row.payload)),
			narration_parts: JSON.parse(String(row.narration_parts)),
			model: row.model === null ? null : String(row.model),
		}));
}
