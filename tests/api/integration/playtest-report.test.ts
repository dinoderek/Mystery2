// The playtest report (report.html), built from a run folder made the way
// `play` makes one: a scripted game against the suite's mock server, its
// subject folder with the events the game saved, and the run's index. Grades are
// written by hand, so no judge runs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DATABASE, resolveDatabaseFile } from '../../../lib/database-target.mjs';
import { signIn } from '../../../evaluation/playtest/lib/api.ts';
import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.ts';
import { readPlayedEvents } from '../../../evaluation/playtest/lib/database.ts';
import { writeGameFolder } from '../../../evaluation/playtest/lib/output.ts';
import { playGame } from '../../../evaluation/playtest/lib/game.ts';
import { buildReportData, renderReport } from '../../../evaluation/playtest/lib/report-page.ts';
import type { Verdict } from '../../../evaluation/core/result.ts';
import { createRunFolder } from '../../../evaluation/core/run-folder.ts';
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from '../../../evaluation/core/result.ts';
import { BASE_URL, MOCK_BLUEPRINT_ID, TEST_CONFIG_ROOT } from './helpers';

const MOCK_BLUEPRINT = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'blueprints', 'mock-blueprint.json'), 'utf8')
);

const INPUTS = [
	'search',
	'help',
	'serch the pantry',
	'talk to alice',
	'Where were you last night?',
	'accuse Alice because of the crumbs',
	'bye',
	'accuse',
	'Alice did it, the crumbs lead to her.',
	'Alice took the cookies: the crumbs and the empty jar both point to her.'
];

interface Turn {
	seq: number | null;
	type: string;
	input: string | null;
	plan: string | null;
	asDialogue: boolean;
	note?: { kind: string; text: string };
	parts: { speaker: string; text: string }[];
	clues: { id: string; text: string | null }[];
}

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

describe('playtest report', () => {
	it('lays out a run folder as turns, with grades beside the turns they cite', async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-playtest-report-'));
		const game = await playGame({
			api: await signIn(BASE_URL, 'playtest-report'),
			blueprint: { id: MOCK_BLUEPRINT_ID, title: 'Mock Blueprint' },
			investigator: scriptedInvestigator(INPUTS)
		});
		expect(game.result).toBe('win');

		// The run as `play` leaves it: an index, and a subject folder for each game.
		const run = createRunFolder({ outputRoot: scratch, command: 'play', argv: [], root: process.cwd(), bindings: [] });
		const folder = run.subject({ kind: 'game', id: game.gameId });
		const gameDir = folder.dir;
		const summary = writeGameFolder({
			dir: gameDir,
			game,
			blueprint: MOCK_BLUEPRINT,
			persona: 'scripted',
			narratorModel: 'mock',
			investigatorModel: 'script',
			callLogFile: null,
			wallMs: 1000,
			events: readPlayedEvents(resolveDatabaseFile(TEST_DATABASE, TEST_CONFIG_ROOT, {}), game.gameId)
		});
		const failedFolder = run.subject({ kind: 'game', id: 'game-2' });
		const writeVerdicts = async (verdicts: Verdict[]) => {
			const base = { schema_version: RESULT_SCHEMA_VERSION, run: run.info(), production: null, timing: null } as const;
			await writeResult(folder.resultFile, {
				...base,
				subject: { kind: 'game', id: game.gameId, path: null },
				verdicts,
				summary: summarize(verdicts),
				run_error: null
			});
			const runError = { stage: 'play', message: 'game-start failed: signed out' };
			await writeResult(failedFolder.resultFile, {
				...base,
				subject: { kind: 'game', id: 'game-2', path: null },
				verdicts: [],
				summary: summarize([], runError),
				run_error: runError
			});
			await run.finish();
		};
		await writeVerdicts([]);

		const ungraded = await buildReportData(run.dir);
		const turns: Turn[] = ungraded.games[0].turns;

		// Every event once, in order; a line that played nothing (refused, or the
		// help view) sits where it was typed, with its text, and has no event.
		// The game saved those two lines too, which is why the numbers skip.
		const sequences = turns.map((turn) => turn.seq).filter((seq) => seq !== null);
		expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
		expect(new Set(sequences).size).toBe(sequences.length);
		expect(turns.map((turn) => turn.type)).not.toContain('no_turn_line');
		const rejected = turns.find((turn) => turn.input === 'serch the pantry');
		expect(rejected).toMatchObject({ seq: null, type: 'feedback', note: { kind: 'feedback' } });
		expect(turns.indexOf(rejected!)).toBeGreaterThan(turns.findIndex((turn) => turn.input === 'search'));
		expect(turns.find((turn) => turn.input === 'help')).toMatchObject({
			seq: null,
			type: 'feedback',
			note: { kind: 'feedback', text: expect.stringContaining('Help menu opened.') }
		});

		// The premise and arrival have no input; every typed line has a row.
		expect(turns[0]).toMatchObject({ seq: 1, type: 'start', input: null });
		expect(turns.filter((turn) => turn.input).map((turn) => turn.input)).toEqual(INPUTS);
		expect(turns.find((turn) => turn.input === 'talk to alice')?.type).toBe('talk');

		// An "accuse" typed mid-conversation is a question to the character.
		expect(turns.find((turn) => turn.input === 'accuse Alice because of the crumbs')).toMatchObject({
			type: 'ask',
			asDialogue: true
		});
		expect(turns.find((turn) => turn.input === 'Where were you last night?')?.asDialogue).toBe(false);

		// Clues carry the blueprint's text, found in the repo's blueprints/.
		// A clue a turn records again shows again, so compare the distinct ids.
		const clues = turns.flatMap((turn) => turn.clues);
		expect(new Set(clues.map((clue) => clue.id))).toEqual(new Set(summary.clue_ids_found));
		expect(clues.every((clue) => typeof clue.text === 'string' && clue.text.length > 0)).toBe(true);

		expect(ungraded.games[0].findings).toEqual([]);
		expect(ungraded.failed).toEqual([{ number: 2, error: 'game-start failed: signed out' }]);

		// Grades, as --judge leaves them.
		const asked = turns.find((turn) => turn.input === 'Where were you last night?')!;
		fs.writeFileSync(
			path.join(gameDir, 'summary.json'),
			JSON.stringify({
				...summary,
				grades: {
					mechanical: { clue_accounting: 'fail' },
					judges: { gm_spoiler: { status: 'fail', major: 1, minor: 0 } }
				}
			})
		);
		await writeVerdicts([
			{
				id: 'clue_accounting',
				tier: 'mechanical',
				status: 'fail',
				details: { violations: [{ sequence: asked.seq, reason: 'clue_revealed_again', clue_id: 'clue-x' }] }
			},
			{
				id: 'gm_spoiler',
				tier: 'judge',
				status: 'fail',
				findings: [
					{ sequence: asked.seq, severity: 'major', kind: 'confirmation', quote: '</script><b>', why: 'Named the culprit.' }
				]
			}
		]);

		const graded = await buildReportData(run.dir);
		expect(graded.games[0].judges).toEqual({ gm_spoiler: { status: 'fail', major: 1, minor: 0 } });
		expect(graded.games[0].findings).toEqual([
			{
				check: 'clue_accounting',
				sequence: asked.seq,
				severity: 'mechanical',
				kind: 'clue_revealed_again',
				quote: null,
				why: 'clue_id: clue-x'
			},
			{
				check: 'gm_spoiler',
				sequence: asked.seq,
				severity: 'major',
				kind: 'confirmation',
				quote: '</script><b>',
				why: 'Named the culprit.'
			}
		]);

		// The page inlines the data whole, and nothing in it closes the script early.
		const html = renderReport(graded);
		const inlined = html.split('<script type="application/json" id="data">')[1].split('</script>')[0];
		expect(JSON.parse(inlined)).toEqual(graded);
		expect(html).toContain(`<title>${MOCK_BLUEPRINT.metadata.title} Playtest</title>`);
		expect(html).not.toContain('__REPORT_');
	});
});
