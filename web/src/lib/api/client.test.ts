import { afterEach, describe, expect, it, vi } from 'vitest';

import { blueprintImageUrl, callApi, callApiDelete, callApiGet } from './client';

/** What the browser sends and reads: these tests stub `fetch`, nothing else. */
const fetchMock = vi.fn();

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal('fetch', fetchMock);
}

describe('callApi', () => {
  it('posts the body as JSON and returns the parsed data', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({ ok: true }));

    const result = await callApi('game-turn', { game_id: 'g1', input: 'look' });

    expect(fetchMock).toHaveBeenCalledWith('/api/game-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: 'g1', input: 'look' }),
    });
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it('sends an empty JSON object when there is no body', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({}));

    await callApi('blueprints-list');

    expect(fetchMock.mock.calls[0][1].body).toBe('{}');
  });

  it("reports the server's error message and status, keeping the payload", async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({ error: 'No such game', detail: 1 }, 404));

    const result = await callApi('game-get', { game_id: 'nope' });

    expect(result.error).toEqual({ message: 'No such game', status: 404 });
    expect(result.data).toEqual({ error: 'No such game', detail: 1 });
  });

  it('falls back to the status when the error body has no message', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({ error: 42 }, 503));

    expect((await callApi('x')).error).toEqual({
      message: 'Request failed (503)',
      status: 503,
    });
  });

  it('falls back to the status when the error body is not JSON', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply('<html>bad gateway</html>', 502));

    const result = await callApi('x');

    expect(result.error).toEqual({ message: 'Request failed (502)', status: 502 });
    expect(result.data).toBeNull();
  });

  it('reads an unreachable server as an error without a status', async () => {
    stubFetch();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await callApi('x')).toEqual({
      data: null,
      error: { message: 'Failed to fetch' },
    });
  });

  it('stringifies a thrown value that is not an Error', async () => {
    stubFetch();
    fetchMock.mockRejectedValue('offline');

    expect((await callApi('x')).error).toEqual({ message: 'offline' });
  });
});

describe('callApiGet and callApiDelete', () => {
  it('put the query on the URL and use their own method', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({ ok: 1 }));

    await callApiGet('game-get', { game_id: 'a b' });
    await callApiDelete('ai-settings/keys', { label: 'main' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/game-get?game_id=a+b', {
      method: 'GET',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/ai-settings/keys?label=main', {
      method: 'DELETE',
    });
  });

  it('leave the URL bare without a query', async () => {
    stubFetch();
    fetchMock.mockResolvedValue(reply({ ok: 1 }));

    await callApiGet('sessions-list');
    await callApiDelete('player');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/sessions-list',
      '/api/player',
    ]);
  });

  it('return errors and network failures the way callApi does', async () => {
    stubFetch();
    fetchMock.mockResolvedValueOnce(reply({ error: 'locked' }, 409));
    fetchMock.mockRejectedValueOnce(new Error('down'));
    fetchMock.mockResolvedValueOnce(reply({ error: 'gone' }, 410));
    fetchMock.mockRejectedValueOnce(new Error('down too'));

    expect((await callApiGet('a')).error).toEqual({ message: 'locked', status: 409 });
    expect((await callApiGet('a')).error).toEqual({ message: 'down' });
    expect((await callApiDelete('a')).error).toEqual({ message: 'gone', status: 410 });
    expect((await callApiDelete('a')).error).toEqual({ message: 'down too' });
  });
});

describe('blueprintImageUrl', () => {
  it('encodes both ids into the image path', () => {
    expect(blueprintImageUrl('mystery one', 'a/b')).toBe('/api/images/mystery%20one/a%2Fb');
  });
});
