// `./dev eval play` and `./dev eval report` before any game is played: what is
// refused up front, what the investigator's reply must hold to count, and what
// the report makes of a run folder on disk. A game played end to end on stub
// bindings is tests/api/integration/playtest-command.test.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEval } from '../../../evaluation/core/dispatch.ts';
import { parseReply } from '../../../evaluation/playtest/lib/investigator.ts';
import { createPlayCommand } from '../../../evaluation/playtest/play.ts';
import { reportCommand } from '../../../evaluation/playtest/report.ts';

const REPO_ROOT = process.cwd();
const FIXTURE_RUN = path.join(REPO_ROOT, 'tests', 'api', 'unit', 'fixtures', 'playtest-run');
const STUB_BINDING = { cmd: process.execPath, args: ['-e', ''], timeout_ms: 1000 };

let scratch = '';

beforeEach(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-playtest-command-'));
});

afterEach(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

function writeConfig(bindings: Record<string, unknown>): string {
	const file = path.join(scratch, 'config.json');
	fs.writeFileSync(file, JSON.stringify(bindings));
	return file;
}

/** Runs a command with the options, and says what it printed and returned. */
async function run(command: Parameters<typeof runEval>[2][number], argv: string[]) {
	const lines: string[] = [];
	const code = await runEval(
		argv,
		{ root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: {} },
		[command]
	);
	return { code, output: lines.join('\n') };
}

describe('play refuses what it cannot run, before it starts a server', () => {
	const startServer = vi.fn();
	const play = (...args: string[]) => run(createPlayCommand({ startServer }), ['play', ...args]);

	afterEach(() => startServer.mockReset());

	it.each([
		[[], '--blueprint or --replay is required'],
		[['--blueprint', 'mock-blueprint', '--narrator', 'loud'], '--narrator must be claude or mock'],
		[['--blueprint', 'mock-blueprint', '--games', '0'], '--games needs a positive integer'],
		[['--blueprint', 'mock-blueprint', '--persona', 'pirate'], 'Unknown persona "pirate". Known: detective, kid-7'],
		[['--blueprint', 'no-such-blueprint'], 'No blueprint matches "no-such-blueprint"'],
		[['--replay', 'script.json', '--persona', 'detective'], 'drop --persona'],
		[['--replay', 'script.json', '--model-override', 'investigator=opus'], 'calls no investigator'],
		[['--replay', path.join('no', 'such', 'script.json')], 'Cannot replay']
	])('%j', async (args, message) => {
		const { code, output } = await play(...args);
		expect(code).toBe(1);
		expect(output).toContain(message);
		expect(startServer).not.toHaveBeenCalled();
	});

	it('stops for a binding that cannot run, instead of playing without it', async () => {
		const outputRoot = path.join(scratch, 'out');
		const base = ['--blueprint', 'mock-blueprint', '--output-root', outputRoot];

		const noInvestigator = await play(...base, '--config', writeConfig({ 'game-judge': STUB_BINDING }));
		expect(noInvestigator.code).toBe(1);
		expect(noInvestigator.output).toContain('no binding "investigator"');

		const noJudge = await play(...base, '--judge', '--config', writeConfig({ investigator: STUB_BINDING }));
		expect(noJudge.code).toBe(1);
		expect(noJudge.output).toContain('no binding "game-judge"');

		const brokenJudge = await play(
			...base,
			'--judge',
			'--config',
			writeConfig({ investigator: STUB_BINDING, 'game-judge': { ...STUB_BINDING, cmd: 'no-such-command' } })
		);
		expect(brokenJudge.code).toBe(1);
		expect(brokenJudge.output).toContain('cannot run');

		// Nothing was started, and nothing was written.
		expect(startServer).not.toHaveBeenCalled();
		expect(fs.existsSync(outputRoot)).toBe(false);
	});

	it('records a game that cannot start as a broken run, and still writes the report', async () => {
		const stopped = vi.fn(async () => {});
		// A server that is not there: signing in fails, so no game starts.
		startServer.mockResolvedValue({ url: 'http://127.0.0.1:9', configRoot: scratch, databaseFile: path.join(scratch, 'none.db'), stop: stopped });
		const outputRoot = path.join(scratch, 'out');
		const { code, output } = await play(
			'--blueprint',
			'mock-blueprint',
			'--output-root',
			outputRoot,
			'--config',
			writeConfig({ investigator: STUB_BINDING })
		);
		expect(code, output).toBe(1);
		expect(output).toContain('[game 1] failed');
		expect(stopped).toHaveBeenCalled();
		const [day] = fs.readdirSync(outputRoot);
		const runDir = path.join(outputRoot, day, fs.readdirSync(path.join(outputRoot, day))[0]);
		const result = JSON.parse(fs.readFileSync(path.join(runDir, 'game-1', 'result.json'), 'utf8'));
		expect(result.subject).toMatchObject({ kind: 'game', id: 'game-1' });
		expect(result.run_error).toMatchObject({ stage: 'play' });
		expect(result.summary.passed).toBe(false);
		expect(fs.existsSync(path.join(runDir, 'report.html'))).toBe(true);
	});

	it('does not need an investigator to replay, only the script it names', async () => {
		const script = path.join(scratch, 'script.json');
		fs.writeFileSync(script, JSON.stringify({ blueprint_id: 'someone-else', inputs: ['search'] }));
		const { code, output } = await play('--replay', script, '--blueprint', 'mock-blueprint', '--config', writeConfig({}));
		expect(code).toBe(1);
		expect(output).toContain('The script was played on "someone-else"');
		expect(startServer).not.toHaveBeenCalled();
	});
});

describe("the investigator's reply", () => {
	const envelope = (fields: Record<string, unknown>) => JSON.stringify({ is_error: false, ...fields });

	it('is the structured input and plan, trimmed, and the model that wrote most of it', () => {
		expect(
			parseReply(
				envelope({
					structured_output: { plan: '  look around ', input: ' search the kitchen  ' },
					modelUsage: { 'claude-haiku-helper': { outputTokens: 1 }, 'claude-sonnet-test': { outputTokens: 40 } }
				})
			)
		).toEqual({ input: 'search the kitchen', plan: 'look around', model: 'claude-sonnet-test' });
		expect(parseReply(envelope({ structured_output: { input: 'look' } }))).toEqual({ input: 'look', plan: '', model: null });
	});

	it.each([
		['not JSON', 'sorry', /JSON/],
		['an error the CLI reported', envelope({ is_error: true, result: 'rate limited' }), /rate limited/],
		['no structured output', envelope({ result: 'search' }), /no input/],
		['an input of only spaces', envelope({ structured_output: { plan: 'x', input: '   ' } }), /no input/]
	])('is rejected, so the runner tries again, for %s', (_name, answer, message) => {
		expect(() => parseReply(answer)).toThrow(message);
	});
});

describe('report on a committed run folder', () => {
	function copyRun(into = path.join(scratch, 'run')): string {
		fs.cpSync(FIXTURE_RUN, into, { recursive: true });
		return into;
	}

	/** The data the page carries, read back out of the HTML. */
	function pageData(runDir: string) {
		const html = fs.readFileSync(path.join(runDir, 'report.html'), 'utf8');
		const inlined = html.split('<script type="application/json" id="data">')[1].split('</script>')[0];
		return { html, data: JSON.parse(inlined) };
	}

	it('writes the page: turns from the saved events, grades beside the turns they cite', async () => {
		const runDir = copyRun();
		const { code, output } = await run(reportCommand, ['report', runDir]);
		expect(code, output).toBe(0);
		expect(output).toContain('report.html');

		const { html, data } = pageData(runDir);
		expect(html).toContain('<title>The Missing Cookies Playtest</title>');
		expect(html).not.toContain('__REPORT_');
		// Nothing a judge quoted can close the script the data sits in.
		expect(html).not.toContain('</script><b>');
		expect(data).toMatchObject({ title: 'The Missing Cookies', persona: 'detective', narratorModel: 'mock', investigatorModel: 'stub-model' });

		const [game] = data.games;
		expect(game).toMatchObject({
			number: 1,
			outcome: 'win',
			cluesFound: 1,
			cluesTotal: 2,
			cost: { narrator: null, investigator: 0.03, judges: 0.5 },
			judges: { gm_spoiler: { status: 'fail', major: 1, minor: 0 } }
		});
		expect(game.findings).toEqual([
			{ check: 'clue_accounting', sequence: 5, severity: 'mechanical', kind: 'clue_revealed_again', quote: null, why: 'clue_id: clue-x' },
			{ check: 'gm_spoiler', sequence: 5, severity: 'major', kind: 'confirmation', quote: '</script><b>', why: 'Named the culprit.' }
		]);

		// Events and typed lines in order: a refused line sits where it was typed, with its text.
		expect(game.turns.map((turn: { seq: number | null; type: string; input: string | null }) => [turn.seq, turn.type, turn.input])).toEqual([
			[1, 'start', null],
			[3, 'search', 'search'],
			[null, 'feedback', 'serch the pantry'],
			[5, 'ask', 'accuse Alice because of the crumbs']
		]);
		expect(game.turns[1]).toMatchObject({
			clues: [{ id: 'clue-crumb', text: 'A crumb on the floor.' }],
			grade: { value: 8, pass: false },
			turnsLeft: 5
		});
		expect(game.turns[2].note).toEqual({ kind: 'feedback', text: 'Try: search' });
		expect(game.turns[3]).toMatchObject({ asDialogue: true, parts: [{ speaker: 'Alice Smith', character: true }] });

		// A game that never started is named, with why.
		expect(data.failed).toEqual([{ number: 2, error: 'game-start failed: signed out' }]);
	});

	it('numbers the games as the run did, whatever order they finished in', async () => {
		const runDir = copyRun();
		const file = path.join(runDir, '11111111-2222-4333-8444-555555555555', 'summary.json');
		fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), game_number: 3 }));
		await run(reportCommand, ['report', runDir]);
		const { data } = pageData(runDir);
		expect(data.games.map((game: { number: number }) => game.number)).toEqual([3]);
		expect(data.failed).toEqual([{ number: 2, error: 'game-start failed: signed out' }]);
	});

	it('finds a run by its id under the output root', async () => {
		const outputRoot = path.join(scratch, 'out');
		const runDir = copyRun(path.join(outputRoot, '2026-01-02', '03-04-05-play'));
		const { code, output } = await run(reportCommand, ['report', '2026-01-02/03-04-05-play', '--output-root', outputRoot]);
		expect(code, output).toBe(0);
		expect(fs.existsSync(path.join(runDir, 'report.html'))).toBe(true);
	});

	it('says why a folder is not a self-play run', async () => {
		const empty = path.join(scratch, 'empty');
		fs.mkdirSync(empty);
		expect((await run(reportCommand, ['report', empty])).output).toContain('has no run.json');

		const other = copyRun();
		const index = JSON.parse(fs.readFileSync(path.join(other, 'run.json'), 'utf8'));
		index.run.command = 'judge game';
		fs.writeFileSync(path.join(other, 'run.json'), JSON.stringify(index));
		const refused = await run(reportCommand, ['report', other]);
		expect(refused.code).toBe(1);
		expect(refused.output).toContain('is a "judge game" run, not a "play" run');

		const missing = await run(reportCommand, ['report', path.join(scratch, 'nowhere'), '--output-root', scratch]);
		expect(missing.code).toBe(1);
		expect(missing.output).toContain('no run folder at');
	});
});
