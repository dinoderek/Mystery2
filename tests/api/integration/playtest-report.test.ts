// The playtest report (report.html), built from a run folder made the way
// eval:playtest makes one: a scripted game against the suite's mock server,
// its folder, and a copy of the database. Grades are written by hand, so no
// judge runs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DATABASE, resolveDatabaseFile } from '../../../lib/database-target.mjs';
import { signIn } from '../../../evaluation/playtest/lib/api.mjs';
import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.mjs';
import { writeGameFolder } from '../../../evaluation/playtest/lib/output.mjs';
import { playGame } from '../../../evaluation/playtest/lib/play.mjs';
import { buildReportData, renderReport } from '../../../evaluation/playtest/lib/report.mjs';
import { BASE_URL, MOCK_BLUEPRINT_ID, TEST_CONFIG_ROOT } from './helpers';

const MOCK_BLUEPRINT = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'blueprints', 'mock-blueprint.json'), 'utf8')
);

const INPUTS = [
	'search',
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

		const gameDir = path.join(scratch, 'game-1');
		const summary = writeGameFolder({
			dir: gameDir,
			game,
			blueprint: MOCK_BLUEPRINT,
			persona: 'scripted',
			narratorModel: 'mock',
			investigatorModel: 'script',
			callLogFile: null,
			wallMs: 1000
		});
		const live = new Database(resolveDatabaseFile(TEST_DATABASE, TEST_CONFIG_ROOT, {}), { readonly: true });
		try {
			await live.backup(path.join(scratch, 'game.db'));
		} finally {
			live.close();
		}
		fs.writeFileSync(
			path.join(scratch, 'summary.json'),
			JSON.stringify([summary, { game: 2, error: 'game-start failed: signed out' }])
		);

		const ungraded = buildReportData(scratch);
		const turns: Turn[] = ungraded.games[0].turns;

		// Every event once, in order; the line the parser rejected sits where it
		// was typed, with its hint, and has no event.
		const sequences = turns.map((turn) => turn.seq).filter((seq) => seq !== null);
		expect(sequences).toEqual(sequences.map((_, index) => index + 1));
		const rejected = turns.find((turn) => turn.input === 'serch the pantry');
		expect(rejected).toMatchObject({ seq: null, type: 'feedback', note: { kind: 'feedback' } });
		expect(turns.indexOf(rejected!)).toBeGreaterThan(turns.findIndex((turn) => turn.input === 'search'));

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
		fs.writeFileSync(
			path.join(gameDir, 'result.json'),
			JSON.stringify({
				mechanical: [
					{
						id: 'clue_accounting',
						status: 'fail',
						details: { violations: [{ sequence: asked.seq, reason: 'clue_revealed_again', clue_id: 'clue-x' }] }
					}
				],
				dimensions: [
					{
						id: 'gm_spoiler',
						judge: {
							raw: {
								findings: [
									{ sequence: asked.seq, severity: 'major', kind: 'confirmation', quote: '</script><b>', why: 'Named the culprit.' }
								]
							}
						}
					}
				]
			})
		);

		const graded = buildReportData(scratch);
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
