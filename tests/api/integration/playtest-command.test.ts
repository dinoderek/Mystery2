// `./dev eval play`, end to end on stub bindings: a stub investigator plays the
// mock blueprint through a server of the command's own on a temporary database,
// the mock narrator narrates, a stub judge grades. No model is called.
//
// It starts the build the suite already made, because building again would
// replace the files the suite's own server is running from.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runEval } from '../../../evaluation/core/dispatch.ts';
import { readResult } from '../../../evaluation/core/result.ts';
import { readRunIndex } from '../../../evaluation/core/run-folder.ts';
import { createPlayCommand } from '../../../evaluation/playtest/play.ts';
import { reportCommand } from '../../../evaluation/playtest/report.ts';
import type { StartServer, ThrowawayServer } from '../../../evaluation/runtime/lib/replay-server.ts';
import { startTestServer } from '../../../scripts/lib/test-server.mjs';

const REPO_ROOT = process.cwd();
const STUB_INVESTIGATOR = path.join(REPO_ROOT, 'tests', 'api', 'integration', 'stub-investigator.mjs');
const STUB_JUDGE = path.join(REPO_ROOT, 'tests', 'api', 'unit', 'trace-mock-judge.mjs');
const PROMPT_FILES = ['{{system_prompt_file}}', '{{user_message_file}}'];

let scratch = '';
let decoy = '';
let config = '';

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-eval-play-'));
	// Anything that resolved a config root from the environment would land here.
	decoy = fs.mkdtempSync(path.join(scratch, 'play-config-root-'));
	vi.stubEnv('MYSTERY_CONFIG_ROOT', decoy);
	vi.stubEnv('MYSTERY_DATABASE', '');
	config = path.join(scratch, 'config.json');
	fs.writeFileSync(
		config,
		JSON.stringify({
			investigator: {
				cmd: process.execPath,
				args: [STUB_INVESTIGATOR, ...PROMPT_FILES],
				model: 'stub-model',
				timeout_ms: 30_000,
				retries: 1
			},
			'game-judge': {
				cmd: process.execPath,
				args: [STUB_JUDGE, ...PROMPT_FILES],
				extract_path: 'result',
				timeout_ms: 30_000,
				retries: 0
			}
		})
	);
});

afterAll(() => {
	vi.unstubAllEnvs();
	fs.rmSync(scratch, { recursive: true, force: true });
});

function repoDatabases(): string[] {
	const dir = path.join(REPO_ROOT, 'database');
	return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** Runs `play` with the options, on the suite's build, and reports what it did. */
async function play(args: string[], env: Record<string, string> = {}) {
	const servers: ThrowawayServer[] = [];
	const startServer: StartServer = async (options) => {
		const server = (await startTestServer({ ...options, build: false })) as ThrowawayServer;
		servers.push(server);
		return server;
	};
	const outputRoot = fs.mkdtempSync(path.join(scratch, 'out-'));
	const lines: string[] = [];
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
	let code: number;
	try {
		code = await runEval(
			['play', ...args, '--config', config, '--output-root', outputRoot],
			{ root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
			[createPlayCommand({ startServer })]
		);
	} finally {
		for (const name of Object.keys(env)) vi.stubEnv(name, undefined);
	}
	const [day] = fs.readdirSync(outputRoot);
	const runDir = day ? path.join(outputRoot, day, fs.readdirSync(path.join(outputRoot, day))[0]) : null;
	return { code, output: lines.join('\n'), servers, outputRoot, runDir };
}

function gameDirs(runDir: string): string[] {
	return readRunIndex(runDir).subjects.map((subject) => path.join(runDir, subject.dir));
}

/** A game's transcript as it reads, without what differs between two games of the same inputs: the ids, and the plan only an investigator writes. */
function playedLines(gameDir: string): string[] {
	const text = fs.readFileSync(path.join(gameDir, 'transcript.md'), 'utf8').split('\n---\n')[0];
	return text.split('\n').filter((line) => line && !line.startsWith('Game `') && !line.startsWith('Replay of') && !line.startsWith('*('));
}

describe('play on stub bindings', () => {
	it('plays a short game, writes a valid result, grades it, and replays the same lines', async () => {
		const before = repoDatabases();
		const played = await play(['--blueprint', 'mock-blueprint', '--narrator', 'mock', '--judge']);
		expect(played.code, played.output).toBe(0);
		const runDir = played.runDir as string;

		// One game, a subject with a valid result: the model calls that played it, and the verdicts that graded it.
		const [gameDir] = gameDirs(runDir);
		const result = await readResult(path.join(gameDir, 'result.json'));
		expect(result.run.command).toBe('play');
		expect(result.run.bindings).toMatchObject({ investigator: { model: 'stub-model' }, 'game-judge': {} });
		expect(result.subject).toMatchObject({ kind: 'game', path: 'trace.json' });
		expect(result.run_error).toBeNull();
		expect(result.summary.passed).toBe(true);
		expect(result.production?.calls).toHaveLength(7);
		expect(result.production?.calls[0]).toMatchObject({ binding: 'investigator', model: 'stub-model', cost_usd: 0.01 });
		expect(result.verdicts.map((verdict) => verdict.id)).toEqual(
			expect.arrayContaining(['clue_accounting', 'gm_roleplay', 'gm_clue_discipline', 'gm_fabrication', 'gm_spoiler'])
		);
		expect(result.subject.id).toBe(JSON.parse(fs.readFileSync(path.join(gameDir, 'summary.json'), 'utf8')).game_id);

		// The game, as the harness always wrote it, plus the model's logs inside the game's folder.
		const summary = JSON.parse(fs.readFileSync(path.join(gameDir, 'summary.json'), 'utf8'));
		expect(summary).toMatchObject({
			game_number: 1,
			outcome: 'win',
			stop_reason: 'ended',
			investigator_model: 'stub-model',
			narrator_model: 'mock',
			grades: { run_error: null, judges: { gm_spoiler: { status: 'pass' } } }
		});
		const steps = fs
			.readFileSync(path.join(gameDir, 'steps.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(steps).toHaveLength(7);
		expect(steps[0].investigator).toMatchObject({ model: 'stub-model', cost_usd: 0.01, attempts: 1 });
		expect(fs.readdirSync(path.join(gameDir, 'logs'))).toContain('investigator-1.attempt-1.invocation.json');
		expect(fs.readFileSync(path.join(gameDir, 'transcript.md'), 'utf8')).toContain('## Grades');
		expect(fs.existsSync(path.join(gameDir, 'trace.json'))).toBe(true);
		expect(fs.existsSync(path.join(runDir, 'game.db'))).toBe(true);
		expect(fs.readFileSync(path.join(runDir, 'report.html'), 'utf8')).toContain('Mock Blueprint Playtest');
		expect(readRunIndex(runDir).exit_code).toBe(0);

		// The server was the command's own, on a temporary database, and is gone.
		expect(played.servers).toHaveLength(1);
		expect(fs.existsSync(played.servers[0].configRoot)).toBe(false);
		expect(fs.readdirSync(decoy)).toEqual([]);
		expect(repoDatabases()).toEqual(before);

		// A replay of the written script types the same lines and reaches the same end, with no investigator.
		const replayed = await play(['--replay', path.join(gameDir, 'script.json'), '--narrator', 'mock']);
		expect(replayed.code, replayed.output).toBe(0);
		const [replayDir] = gameDirs(replayed.runDir as string);
		expect(playedLines(replayDir)).toEqual(playedLines(gameDir));
		expect(JSON.parse(fs.readFileSync(path.join(replayDir, 'script.json'), 'utf8'))).toEqual(
			JSON.parse(fs.readFileSync(path.join(gameDir, 'script.json'), 'utf8'))
		);
		const replayResult = await readResult(path.join(replayDir, 'result.json'));
		expect(replayResult.production).toBeNull();
		expect(replayResult.verdicts).toEqual([]);
		expect(JSON.parse(fs.readFileSync(path.join(replayDir, 'summary.json'), 'utf8'))).toMatchObject({
			outcome: 'win',
			investigator_model: 'replay',
			divergence: null
		});

		// `report` writes the page again from what is on disk.
		fs.rmSync(path.join(runDir, 'report.html'));
		const lines: string[] = [];
		const reported = await runEval(
			['report', runDir],
			{ root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
			[reportCommand]
		);
		expect(reported).toBe(0);
		expect(fs.existsSync(path.join(runDir, 'report.html'))).toBe(true);
	}, 120_000);

	it('exits 2 when a judge fails the game', async () => {
		const played = await play(['--blueprint', 'mock-blueprint', '--narrator', 'mock', '--judge'], {
			MOCK_JUDGE_MODE: 'fail'
		});
		expect(played.code, played.output).toBe(2);
		const [gameDir] = gameDirs(played.runDir as string);
		const result = await readResult(path.join(gameDir, 'result.json'));
		expect(result.run_error).toBeNull();
		expect(result.summary.passed).toBe(false);
		expect(result.verdicts.filter((verdict) => verdict.status === 'fail').length).toBeGreaterThan(0);
	}, 120_000);

	it('exits 1 when the investigator cannot be called, keeping what it tried', async () => {
		const played = await play(['--blueprint', 'mock-blueprint', '--narrator', 'mock'], {
			STUB_INVESTIGATOR_MODE: 'crash'
		});
		expect(played.code, played.output).toBe(1);
		const [gameDir] = gameDirs(played.runDir as string);
		const result = await readResult(path.join(gameDir, 'result.json'));
		expect(result.run_error).toMatchObject({ stage: 'play', message: expect.stringContaining('investigator') });
		// Two attempts, as the binding allows, both kept.
		expect(result.production?.calls[0].attempts.map((attempt) => attempt.outcome)).toEqual(['exit', 'exit']);
		expect(fs.readdirSync(path.join(gameDir, 'logs'))).toContain('investigator-1.attempt-2.stderr.log');
	}, 120_000);
});
