// The evaluation scripts a workspace or a wrapper starts as a process, run here
// in-process with `process.exit` and the output streams captured: what each
// says and which exit code it ends with, for a good input and for each way the
// input can be wrong. Plus the baseline case file, which is data the runtime
// harness loads rather than code.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCasesFrom } from '../../../evaluation/runtime/lib/case.ts';
import { ACTIONS } from '../../../evaluation/runtime/lib/roles.ts';

const REPO_ROOT = process.cwd();
const VALIDATE_JUDGE = path.join(REPO_ROOT, 'evaluation/judge-harness/scripts/validate-judge-output.ts');

let dir = '';
let nonce = 0;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-eval-scripts-'));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	fs.rmSync(dir, { recursive: true, force: true });
});

interface Ran {
	code: number | undefined;
	stdout: string;
	stderr: string;
}

class Exit extends Error {}

/**
 * Imports a script as `node <script> <args>` would start it, from `cwd`, and
 * answers once it first calls `process.exit`. Later exits (a fatal handler's)
 * are ignored, since a real process would be gone.
 */
async function runScript(script: string, args: string[], { cwd = dir, waitMs = 3000 } = {}): Promise<Ran> {
	let stdout = '';
	let stderr = '';
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => ((stdout += String(chunk)), true));
	vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => ((stderr += String(chunk)), true));
	vi.spyOn(process, 'cwd').mockReturnValue(cwd);
	vi.spyOn(process, 'argv', 'get').mockReturnValue([process.execPath, script, ...args]);
	const exited = new Promise<number | undefined>((resolve) => {
		let first = true;
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			if (!first) return undefined as never;
			first = false;
			resolve(code);
			throw new Exit();
		}) as never);
	});
	await import(`${script}?run=${(nonce += 1)}`).catch((error: unknown) => {
		if (!(error instanceof Exit)) throw error;
	});
	const code = await Promise.race([exited, new Promise<undefined>((resolve) => setTimeout(resolve, waitMs))]);
	// Let a failing script's own handlers finish before the real streams and exit come back.
	await new Promise((resolve) => setTimeout(resolve, 20));
	vi.restoreAllMocks();
	return { code, stdout, stderr };
}

function write(name: string, content: unknown): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
	return file;
}

describe('validate-judge-output', () => {
	const dragon = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'blueprints/clue-graph/dragon-crown.json'), 'utf8'));

	function workspace(dimension = 'cg_truth_agreement'): void {
		write('dimension-id', `${dimension}\n`);
		write('case.json', dragon);
	}

	const answer = (ids: string[]) => ({
		findings: [{ severity: 'minor', kind: 'detail_mismatch', ids, explanation: 'A small slip.' }],
		verdict: 'pass',
		reasoning: 'r'
	});

	it('exits 0 when the verdict has the right shape and cites only what the case holds', async () => {
		workspace();
		const file = write('verdict.json', answer(['pike_roof', 'pike']));
		expect(await runScript(VALIDATE_JUDGE, [file])).toMatchObject({ code: 0, stdout: `OK: ${file} (cg_truth_agreement) [shape + refs]\n` });
	});

	it('exits 1 for a verdict of the wrong shape', async () => {
		workspace();
		const ran = await runScript(VALIDATE_JUDGE, [write('verdict.json', { verdict: 'maybe' })]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain('INVALID cg_truth_agreement');
		expect(ran.stderr).toContain('shape failure');
	});

	it('exits 1 for a verdict that cites an id the case does not hold', async () => {
		workspace();
		const ran = await runScript(VALIDATE_JUDGE, [write('verdict.json', answer(['no_such_clue']))]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toMatch(/reference\/coverage issue\(s\)/);
		expect(ran.stderr).toContain('no_such_clue');
	});

	it('exits 2 when the workspace is not set up: no dimension, an unknown one, or no case or verdict', async () => {
		expect(await runScript(VALIDATE_JUDGE, [path.join(dir, 'verdict.json')])).toMatchObject({
			code: 2,
			stderr: expect.stringContaining('could not read ./dimension-id')
		});

		workspace('no_such_judge');
		expect((await runScript(VALIDATE_JUDGE, [write('verdict.json', {})])).code).toBe(2);

		workspace();
		const missingVerdict = await runScript(VALIDATE_JUDGE, [path.join(dir, 'absent.json')]);
		expect(missingVerdict).toMatchObject({ code: 2 });
		expect(missingVerdict.stderr).toContain('could not read');

		fs.rmSync(path.join(dir, 'case.json'));
		const missingCase = await runScript(VALIDATE_JUDGE, [write('verdict.json', answer(['pike']))]);
		expect(missingCase.code).toBe(2);
		expect(missingCase.stderr).toContain('./case.json');
	});

	it('exits 3 with no verdict argument', async () => {
		expect(await runScript(VALIDATE_JUDGE, [])).toMatchObject({ code: 3, stderr: expect.stringContaining('usage:') });
	});
});

describe('the baseline cases', () => {
	it('loads every case with a unique id, each naming an action the replay knows', async () => {
		const cases = await loadCasesFrom(path.join(REPO_ROOT, 'evaluation/runtime/cases'));
		const baseline = await loadCasesFrom(path.join(REPO_ROOT, 'evaluation/runtime/cases/clue-graph/mock-case/all-interactions.ts'));

		expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
		expect(baseline.length).toBeGreaterThan(5);
		for (const testCase of baseline) expect(Object.keys(ACTIONS), testCase.id).toContain(testCase.action.type);
		for (const testCase of baseline) expect(testCase.judges?.length, testCase.id).toBeGreaterThan(0);
	});
});
