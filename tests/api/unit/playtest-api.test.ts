// The self-play game client: it signs in the way the browser does, sends the
// cookie on every call, retries what the web store retries, and answers
// `{ ok: false }` rather than throwing. Calls go to a local HTTP server.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signIn } from '../../../evaluation/playtest/lib/api.ts';

interface Seen {
	method: string;
	url: string;
	cookie: string | undefined;
	body: string;
}

let server: http.Server;
let baseUrl = '';
let seen: Seen[] = [];
let respond: (request: Seen, response: http.ServerResponse) => void;

beforeEach(async () => {
	seen = [];
	respond = (_request, response) => {
		response.setHeader('Content-Type', 'application/json');
		response.end('{}');
	};
	server = http.createServer((request, response) => {
		let body = '';
		request.on('data', (chunk) => (body += chunk));
		request.on('end', () => {
			const entry = { method: request.method ?? '', url: request.url ?? '', cookie: request.headers.cookie, body };
			seen.push(entry);
			respond(entry, response);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	await new Promise((resolve) => server.close(resolve));
});

function signInResponse(request: Seen, response: http.ServerResponse): boolean {
	if (request.url !== '/api/player') return false;
	response.setHeader('Set-Cookie', ['profile=abc; Path=/; HttpOnly', 'other=1; Path=/']);
	response.end('{}');
	return true;
}

describe('signing in', () => {
	it('posts the name and keeps the cookies it is given', async () => {
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify({ state: { mode: 'explore' } }));
		};

		const api = await signIn(baseUrl, 'playtest');
		const answer = await api.get('game-get', { game_id: 'g 1' });

		expect(JSON.parse(seen[0].body)).toEqual({ name: 'playtest' });
		expect(answer).toEqual({ ok: true, status: 200, body: { state: { mode: 'explore' } } });
		expect(seen[1]).toMatchObject({ method: 'GET', url: '/api/game-get?game_id=g+1', cookie: 'profile=abc; other=1' });
	});

	it('refuses with the status and what the server said', async () => {
		respond = (_request, response) => {
			response.statusCode = 403;
			response.end('no');
		};
		await expect(signIn(baseUrl, 'playtest')).rejects.toThrow('Sign-in as "playtest" failed: 403 no');
	});
});

describe('calling the game', () => {
	async function client() {
		return signIn(baseUrl, 'playtest');
	}

	it('posts a JSON body with the cookie', async () => {
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			response.end(JSON.stringify({ kind: 'quit' }));
		};
		const api = await client();
		expect(await api.post('game-turn', { input: 'quit' })).toMatchObject({ ok: true, body: { kind: 'quit' } });
		expect(seen[1]).toMatchObject({ method: 'POST', url: '/api/game-turn', cookie: 'profile=abc; other=1' });
		expect(JSON.parse(seen[1].body)).toEqual({ input: 'quit' });
	});

	it('sends no body when none is given', async () => {
		respond = (request, response) => (signInResponse(request, response) ? undefined : response.end('{}'));
		const api = await client();
		await api.post('game-enter');
		expect(seen[1].body).toBe('');
	});

	it('answers a client error at once, with what the server said', async () => {
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			response.statusCode = 400;
			response.end(JSON.stringify({ error: 'bad input' }));
		};
		const api = await client();
		expect(await api.post('game-turn', {})).toEqual({ ok: false, status: 400, body: { error: 'bad input' } });
		expect(seen).toHaveLength(2);
	});

	it('keeps a body that is not JSON as the error text', async () => {
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			response.statusCode = 404;
			response.end('not here');
		};
		const api = await client();
		expect(await api.get('game-get')).toEqual({ ok: false, status: 404, body: { error: 'not here' } });
	});

	it('retries a server error and returns the answer that follows', async () => {
		let failures = 2;
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			if (failures > 0) {
				failures -= 1;
				response.statusCode = 503;
				response.end('{"error":"busy"}');
				return;
			}
			response.end('{"ok":true}');
		};
		const api = await client();
		const call = api.post('game-turn', {});
		expect(await call).toMatchObject({ ok: true, body: { ok: true } });
		expect(seen).toHaveLength(4);
	});

	it('gives up after three attempts and returns the last failure', async () => {
		respond = (request, response) => {
			if (signInResponse(request, response)) return;
			response.statusCode = 500;
			response.end('{"error":"down"}');
		};
		const api = await client();
		const call = api.post('game-turn', {});
		expect(await call).toEqual({ ok: false, status: 500, body: { error: 'down' } });
		expect(seen.filter((entry) => entry.url === '/api/game-turn')).toHaveLength(3);
	});

	it('returns a network failure as a failed answer rather than throwing', async () => {
		const api = await client();
		await new Promise((resolve) => server.close(resolve));
		server = http.createServer();
		const call = api.get('game-get');
		const answer = await call;
		expect(answer).toMatchObject({ ok: false, status: 0 });
		expect((answer.body as { error: string }).error).toContain('request failed');
	});
});
