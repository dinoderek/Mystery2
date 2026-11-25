import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: postMock,
  callApiGet: getMock,
}));

import { AISettingsStore } from './ai-settings-store.svelte';
import type { AISettingsState } from '../types/ai-settings';

const MOCK = { name: 'mock', backend: 'mock', model: 'mock/runtime-default', problem: null } as const;
const LUNA = { name: 'luna6', backend: 'openrouter', model: 'openai/gpt-6-luna', problem: null } as const;

function settings(overrides: Partial<AISettingsState> = {}): AISettingsState {
  return {
    ais: [MOCK, LUNA],
    chosen: null,
    configured_default: null,
    override: null,
    narrator: { name: 'mock', backend: 'mock', model: 'mock/runtime-default' },
    narrator_error: null,
    ...overrides,
  };
}

const ok = (data: AISettingsState) => ({ data, error: null });
const failed = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
});

describe('AISettingsStore.load', () => {
  it('adopts the state the server returns and stops loading', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValue(ok(settings({ chosen: 'luna6' })));

    await store.load();

    expect(getMock).toHaveBeenCalledWith('ai-settings');
    expect(store.state?.chosen).toBe('luna6');
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('shows the error and leaves the page empty when the first load fails', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValue(failed('Request failed (500)'));

    await store.load();

    expect(store.state).toBeNull();
    expect(store.error).toBe('Request failed (500)');
    expect(store.loading).toBe(false);
  });
});

describe('AISettingsStore.choose', () => {
  it('posts the name and adopts the state the server answers with', async () => {
    const store = new AISettingsStore();
    postMock.mockResolvedValue(ok(settings({ chosen: 'luna6' })));

    expect(await store.choose('luna6')).toBe(true);

    expect(postMock).toHaveBeenCalledWith('ai-settings', { name: 'luna6' });
    expect(store.state?.chosen).toBe('luna6');
    expect(store.saving).toBe(false);
  });

  it('keeps the last state on screen beside a refusal', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValue(ok(settings()));
    await store.load();
    postMock.mockResolvedValue(failed('There is no AI named "gone" in ai.json.'));

    expect(await store.choose('gone')).toBe(false);

    expect(store.state?.chosen).toBeNull();
    expect(store.error).toMatch(/"gone"/);
  });

  it('clears an earlier error once a choice succeeds', async () => {
    const store = new AISettingsStore();
    postMock.mockResolvedValueOnce(failed('nope'));
    postMock.mockResolvedValueOnce(ok(settings({ chosen: 'mock' })));

    await store.choose('gone');
    await store.choose('mock');

    expect(store.error).toBeNull();
    expect(store.state?.chosen).toBe('mock');
  });
});
