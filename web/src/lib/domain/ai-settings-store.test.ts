import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, getMock, deleteMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: postMock,
  callApiGet: getMock,
  callApiDelete: deleteMock,
}));

import { AISettingsStore } from './ai-settings-store.svelte';
import type { AISettingsState } from '../types/ai-settings';

function settings(overrides: Partial<AISettingsState> = {}): AISettingsState {
  return {
    effective_mode: 'mock',
    stored_mode: 'mock',
    selected_key_label: null,
    selected_model_label: null,
    missing_key_label: null,
    missing_model_label: null,
    keys: [],
    models: [],
    override: null,
    ...overrides,
  };
}

const ok = (data: AISettingsState) => ({ data, error: null });
const failed = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
  deleteMock.mockReset();
});

describe('AISettingsStore.load', () => {
  it('adopts the state the server returns and stops loading', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValue(ok(settings({ stored_mode: 'openrouter' })));

    await store.load();

    expect(getMock).toHaveBeenCalledWith('ai-settings');
    expect(store.state?.stored_mode).toBe('openrouter');
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('shows the error and leaves the page empty when the first load fails', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValue(failed('Request failed (500)'));

    await store.load();

    expect(store.error).toBe('Request failed (500)');
    expect(store.state).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('keeps the last known state on screen when a later load fails', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValueOnce(ok(settings({ stored_mode: 'openrouter' })));
    getMock.mockResolvedValueOnce(failed('down'));

    await store.load();
    await store.load();

    expect(store.state?.stored_mode).toBe('openrouter');
    expect(store.error).toBe('down');
  });

  it('clears an earlier error once a load succeeds', async () => {
    const store = new AISettingsStore();
    getMock.mockResolvedValueOnce(failed('down'));
    getMock.mockResolvedValueOnce(ok(settings()));

    await store.load();
    await store.load();

    expect(store.error).toBeNull();
    expect(store.state).not.toBeNull();
  });
});

describe('AISettingsStore writes', () => {
  it('send each change to its own endpoint with the fields the server reads', async () => {
    const store = new AISettingsStore();
    postMock.mockResolvedValue(ok(settings()));
    deleteMock.mockResolvedValue(ok(settings()));

    await store.setMode('openrouter');
    await store.selectKey('main');
    await store.selectModel(null);
    await store.addKey('main', 'sk-1');
    await store.addModel('fast', 'vendor/model');
    await store.deleteKey('main');
    await store.deleteModel('fast');

    expect(postMock.mock.calls).toEqual([
      ['ai-settings', { mode: 'openrouter' }],
      ['ai-settings', { key_label: 'main' }],
      ['ai-settings', { model_label: null }],
      ['ai-settings/keys', { label: 'main', api_key: 'sk-1' }],
      ['ai-settings/models', { label: 'fast', model_id: 'vendor/model' }],
    ]);
    expect(deleteMock.mock.calls).toEqual([
      ['ai-settings/keys', { label: 'main' }],
      ['ai-settings/models', { label: 'fast' }],
    ]);
  });

  it('replace the page state with what the server answers and report success', async () => {
    const store = new AISettingsStore();
    // The server stepped the mode back to mock after the delete; the page must follow.
    store.state = settings({ stored_mode: 'openrouter', selected_key_label: 'main' });
    deleteMock.mockResolvedValue(ok(settings({ stored_mode: 'mock' })));

    expect(await store.deleteKey('main')).toBe(true);

    expect(store.state?.stored_mode).toBe('mock');
    expect(store.saving).toBe(false);
  });

  it('report a rejected write, keep the old state and show the reason', async () => {
    const store = new AISettingsStore();
    store.state = settings({ stored_mode: 'openrouter' });
    postMock.mockResolvedValue(failed('Label in use'));

    expect(await store.addKey('main', 'bad')).toBe(false);

    expect(store.error).toBe('Label in use');
    expect(store.state?.stored_mode).toBe('openrouter');
    expect(store.saving).toBe(false);
  });

  it('are marked as saving while the request is in flight', async () => {
    const store = new AISettingsStore();
    let release: (value: ReturnType<typeof ok>) => void = () => {};
    postMock.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const pending = store.setMode('openrouter');
    expect(store.saving).toBe(true);

    release(ok(settings({ stored_mode: 'openrouter' })));
    await pending;

    expect(store.saving).toBe(false);
  });
});
