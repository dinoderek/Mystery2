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
import { validBlueprintV2 } from './fixtures/blueprint-v2.fixture.ts';
import { generatorBrief } from './fixtures/generator-brief.ts';

const REPO_ROOT = process.cwd();
const VALIDATE_BLUEPRINT = path.join(REPO_ROOT, 'evaluation/generator-harness/scripts/validate-blueprint.ts');
const VALIDATE_JUDGE = path.join(REPO_ROOT, 'evaluation/judge-harness/scripts/validate-judge-output.ts');
const OPENROUTER_WRAPPER = path.join(REPO_ROOT, 'evaluation/generate/openrouter-wrapper.ts');

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

describe('validate-blueprint', () => {
	it('exits 0 for a blueprint that passes the schema', async () => {
		const file = write('blueprint.json', validBlueprintV2);
		const ran = await runScript(VALIDATE_BLUEPRINT, [file]);
		expect(ran).toMatchObject({ code: 0, stdout: `OK: ${file} (BlueprintV2)\n` });
	});

	it('exits 1, naming each issue and where, for one that does not', async () => {
		const file = write('blueprint.json', { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, time_budget: 'ten' } });
		const ran = await runScript(VALIDATE_BLUEPRINT, [file]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain(`INVALID: ${file}`);
		expect(ran.stderr).toContain('metadata.time_budget');
		expect(ran.stderr).toContain('(got: "string")');
	});

	it('names the root when the whole file is the wrong shape', async () => {
		const ran = await runScript(VALIDATE_BLUEPRINT, [write('blueprint.json', [])]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain('(root)');
	});

	it('exits 2 for a file that is missing or not JSON, 3 with no argument', async () => {
		expect(await runScript(VALIDATE_BLUEPRINT, [path.join(dir, 'missing.json')])).toMatchObject({ code: 2, stderr: expect.stringContaining('read error') });
		const notJson = await runScript(VALIDATE_BLUEPRINT, [write('bad.json', '{ nope')]);
		expect(notJson).toMatchObject({ code: 2 });
		expect(notJson.stderr).toContain('invalid JSON');
		expect(await runScript(VALIDATE_BLUEPRINT, [])).toMatchObject({ code: 3, stderr: expect.stringContaining('usage:') });
	});
});

describe('validate-judge-output', () => {
	const innocents = validBlueprintV2.world.characters.filter((character) => !character.is_culprit).map((character) => character.id);

	function workspace(dimension = 'fairness'): void {
		write('dimension-id', `${dimension}\n`);
		write('blueprint.json', validBlueprintV2);
	}

	const verdict = (ids: string[]) => ({
		non_culprits: ids.map((id) => ({ character_id: id, ruled_out: true, ruling_evidence: null, reasoning: 'r' })),
		verdict: 'pass',
		reasoning: 'r'
	});

	it('exits 0 when the verdict has the right shape and cites only what the blueprint holds', async () => {
		workspace();
		const file = write('verdict.json', verdict(innocents));
		expect(await runScript(VALIDATE_JUDGE, [file])).toMatchObject({ code: 0, stdout: `OK: ${file} (fairness) [shape + refs]\n` });
	});

	it('exits 1 for a verdict of the wrong shape', async () => {
		workspace();
		const ran = await runScript(VALIDATE_JUDGE, [write('verdict.json', { verdict: 'maybe' })]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain('INVALID fairness');
		expect(ran.stderr).toContain('shape failure');
	});

	it('exits 1 for a verdict that cites an id the blueprint does not hold', async () => {
		workspace();
		const ran = await runScript(VALIDATE_JUDGE, [write('verdict.json', verdict([...innocents, 'char-nobody']))]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toMatch(/reference\/coverage issue\(s\)/);
		expect(ran.stderr).toContain('char-nobody');
	});

	it('reads the optional context the judge was given', async () => {
		workspace();
		write('context.json', { anything: true });
		expect(await runScript(VALIDATE_JUDGE, [write('verdict.json', verdict(innocents))])).toMatchObject({ code: 0 });
	});

	it('exits 2 when the workspace is not set up: no dimension, an unknown one, or no blueprint or verdict', async () => {
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

		fs.rmSync(path.join(dir, 'blueprint.json'));
		const missingBlueprint = await runScript(VALIDATE_JUDGE, [write('verdict.json', verdict(innocents))]);
		expect(missingBlueprint.code).toBe(2);
		expect(missingBlueprint.stderr).toContain('./blueprint.json');
	});

	it('exits 3 with no verdict argument', async () => {
		expect(await runScript(VALIDATE_JUDGE, [])).toMatchObject({ code: 3, stderr: expect.stringContaining('usage:') });
	});
});

describe('the api generation wrapper', () => {
	const completion = () =>
		new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validBlueprintV2) } }] }), { status: 200 });

	it('prints the model\'s blueprint for the brief it is given', async () => {
		const requests: string[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			requests.push(String(init.body));
			return completion();
		});
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-key-0123456789');
		vi.stubEnv('EVAL_MODEL', 'vendor/some-model');
		const user = write('user.json', { story_brief: generatorBrief });

		const ran = await runScript(OPENROUTER_WRAPPER, [write('system.txt', 'unused'), user], { waitMs: 50 });
		expect(ran.stderr).toBe('');

		expect(ran.code).toBeUndefined();
		expect(requests).toHaveLength(1);
		expect(ran.stdout).toContain(validBlueprintV2.id);
	});

	it('exits 2 with no user message file', async () => {
		const ran = await runScript(OPENROUTER_WRAPPER, []);
		expect(ran).toMatchObject({ code: 2, stderr: expect.stringContaining('usage:') });
	});

	it('exits 1 saying why when the call cannot be made, and never prints the key', async () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-secret-value-9876');
		vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }));
		const ran = await runScript(OPENROUTER_WRAPPER, [write('system.txt', ''), write('user.json', { story_brief: generatorBrief })]);
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain('openrouter-generate:');
		expect(ran.stderr).not.toContain('sk-or-secret-value-9876');
	});
});

describe('the baseline cases', () => {
	it('loads every case with a unique id, each naming an action the replay knows', async () => {
		const cases = await loadCasesFrom(path.join(REPO_ROOT, 'evaluation/runtime/cases'));
		const baseline = await loadCasesFrom(path.join(REPO_ROOT, 'evaluation/runtime/cases/all-interactions.ts'));

		expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
		expect(baseline.length).toBeGreaterThan(5);
		for (const testCase of baseline) expect(Object.keys(ACTIONS), testCase.id).toContain(testCase.action.type);
		for (const testCase of baseline) expect(testCase.judges?.length, testCase.id).toBeGreaterThan(0);
	});
});
