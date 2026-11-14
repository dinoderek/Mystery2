import { describe, expect, it } from 'vitest';

import { aiRows, narratorLine, overrideBanner, selectedName } from './ai-settings-view';
import type { AISettingsState } from '../types/ai-settings';

const MOCK = { name: 'mock', backend: 'mock', model: 'mock/runtime-default', problem: null } as const;
const LUNA = { name: 'luna6', backend: 'openrouter', model: 'openai/gpt-6-luna', problem: null } as const;
const CLAUDE = { name: 'claude', backend: 'claude-cli', model: 'sonnet', problem: null } as const;
const NO_KEY = {
  name: 'free',
  backend: 'openrouter',
  model: 'vendor/free',
  problem: 'AI "free" uses openrouter but has no key',
} as const;

function settings(overrides: Partial<AISettingsState> = {}): AISettingsState {
  return {
    ais: [MOCK, LUNA, CLAUDE, NO_KEY],
    chosen: null,
    override: null,
    narrator: { name: 'mock', backend: 'mock', model: 'mock/runtime-default' },
    narrator_error: null,
    ...overrides,
  };
}

describe('the AI list', () => {
  it('lists every AI with its backend and model, mock first', () => {
    expect(aiRows(settings()).map((row) => [row.name, row.detail])).toEqual([
      ['mock', 'built in, no real AI'],
      ['luna6', 'openrouter / openai/gpt-6-luna'],
      ['claude', 'claude-cli / sonnet'],
      ['free', 'openrouter / vendor/free'],
    ]);
  });

  it('marks the chosen AI and only it', () => {
    const rows = aiRows(settings({ chosen: 'luna6' }));
    expect(rows.filter((row) => row.selected).map((row) => row.name)).toEqual(['luna6']);
  });

  it('marks mock while nothing has been chosen, because mock narrates then', () => {
    expect(selectedName(settings())).toBe('mock');
    expect(aiRows(settings()).find((row) => row.selected)?.name).toBe('mock');
  });

  it('marks nothing when the choice has gone from the file', () => {
    expect(aiRows(settings({ chosen: 'gone' })).some((row) => row.selected)).toBe(false);
  });

  it('carries what an AI lacks, so the page can say why it cannot be chosen', () => {
    expect(aiRows(settings()).find((row) => row.name === 'free')?.problem).toMatch(/no key/);
  });

  it('shows no key, because the state carries none', () => {
    const text = JSON.stringify(aiRows(settings()));
    expect(text).not.toMatch(/sk-|"key"/);
  });
});

describe('the narrator line', () => {
  it('names mock as mock', () => {
    expect(narratorLine(settings())).toEqual({ text: 'NARRATOR: mock (built in, no real AI)', error: false });
  });

  it('names a real AI with its backend and model', () => {
    const state = settings({
      chosen: 'luna6',
      narrator: { name: 'luna6', backend: 'openrouter', model: 'openai/gpt-6-luna' },
    });
    expect(narratorLine(state)).toEqual({ text: 'NARRATOR: luna6 (openrouter / openai/gpt-6-luna)', error: false });
  });

  it('says nothing narrates, naming the AI, when the choice is missing', () => {
    const state = settings({
      chosen: 'gone',
      narrator: null,
      narrator_error: 'The AI chosen on the settings page, "gone", is not in ai.json.',
    });
    const line = narratorLine(state);
    expect(line.error).toBe(true);
    expect(line.text).toMatch(/^NO NARRATOR: .*"gone"/);
  });
});

describe('the override banner', () => {
  it('is absent without a run override', () => {
    expect(overrideBanner(settings())).toBeNull();
  });

  it('names the AI the run was started with', () => {
    const banner = overrideBanner(settings({ override: { name: 'claude', backend: 'claude-cli', model: 'sonnet' } }));
    expect(banner).toMatch(/--ai claude \(claude-cli \/ sonnet\)/);
  });
});
