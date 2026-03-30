import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../api/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { BriefStore } from './brief-store.svelte';
import type { BriefFull, BriefSummary } from '../types/brief';

const SAMPLE_SUMMARY: BriefSummary = {
  id: 'brief-1',
  brief: 'A stolen painting in a Victorian mansion',
  title_hint: 'The Vanishing Vermeer',
  target_age: 10,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-15T00:00:00Z',
  archived_at: null,
};

const SAMPLE_FULL: BriefFull = {
  ...SAMPLE_SUMMARY,
  time_budget: 15,
  art_style: 'watercolor noir',
  must_include: ['hidden passage', 'old diary'],
  culprits: 1,
  suspects: 3,
  witnesses: 2,
  locations: 4,
  red_herring_trails: 1,
  cover_ups: true,
  elimination_complexity: 'moderate',
};

describe('BriefStore', () => {
  let store: BriefStore;

  beforeEach(() => {
    invokeMock.mockReset();
    store = new BriefStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loadBriefs', () => {
    it('populates briefs list on success', async () => {
      invokeMock.mockResolvedValue({
        data: { briefs: [SAMPLE_SUMMARY] },
        error: null,
      });

      await store.loadBriefs();

      expect(store.briefs).toHaveLength(1);
      expect(store.briefs[0].id).toBe('brief-1');
      expect(store.status).toBe('idle');
      expect(store.error).toBeNull();
    });

    it('sets error state on failure', async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: 'Network error' },
      });

      await store.loadBriefs();

      expect(store.briefs).toHaveLength(0);
      expect(store.status).toBe('error');
      expect(store.error).toBe('Failed to load briefs');
    });

    it('transitions through loading state', async () => {
      const states: string[] = [];
      invokeMock.mockImplementation(async () => {
        states.push(store.status);
        return { data: { briefs: [] }, error: null };
      });

      await store.loadBriefs();

      expect(states).toContain('loading');
      expect(store.status).toBe('idle');
    });
  });

  describe('loadBrief', () => {
    it('sets activeBrief on success', async () => {
      invokeMock.mockResolvedValue({
        data: { brief: SAMPLE_FULL },
        error: null,
      });

      await store.loadBrief('brief-1');

      expect(store.activeBrief).toBeTruthy();
      expect(store.activeBrief!.id).toBe('brief-1');
      expect(store.activeBrief!.must_include).toEqual(['hidden passage', 'old diary']);
      expect(store.status).toBe('idle');
    });

    it('sets error on failure', async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      await store.loadBrief('nonexistent');

      expect(store.activeBrief).toBeNull();
      expect(store.status).toBe('error');
    });
  });

  describe('saveBrief', () => {
    it('returns saved brief on success (insert)', async () => {
      const saved = { ...SAMPLE_FULL, id: 'new-id' };
      invokeMock.mockResolvedValue({
        data: { brief: saved },
        error: null,
      });

      const result = await store.saveBrief({
        brief: 'New mystery',
        target_age: 10,
      });

      expect(result).toBeTruthy();
      expect(result!.id).toBe('new-id');
      expect(store.activeBrief!.id).toBe('new-id');
      expect(store.status).toBe('idle');
    });

    it('returns saved brief on success (update)', async () => {
      invokeMock.mockResolvedValue({
        data: { brief: SAMPLE_FULL },
        error: null,
      });

      const result = await store.saveBrief({
        id: 'brief-1',
        brief: 'Updated',
        target_age: 12,
      });

      expect(result).toBeTruthy();
      expect(store.status).toBe('idle');
    });

    it('returns null and sets error on failure', async () => {
      invokeMock.mockResolvedValue({
        data: { error: 'brief is required' },
        error: null,
      });

      const result = await store.saveBrief({});

      expect(result).toBeNull();
      expect(store.status).toBe('error');
      expect(store.error).toBe('brief is required');
    });
  });

  describe('archiveBrief', () => {
    it('removes brief from list on success', async () => {
      store.briefs = [SAMPLE_SUMMARY, { ...SAMPLE_SUMMARY, id: 'brief-2' }];
      invokeMock.mockResolvedValue({
        data: { brief: { id: 'brief-1', archived_at: '2026-03-20T00:00:00Z' } },
        error: null,
      });

      const ok = await store.archiveBrief('brief-1');

      expect(ok).toBe(true);
      expect(store.briefs).toHaveLength(1);
      expect(store.briefs[0].id).toBe('brief-2');
    });

    it('returns false and sets error on failure', async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: 'Failed' },
      });

      const ok = await store.archiveBrief('brief-1');

      expect(ok).toBe(false);
      expect(store.error).toBe('Failed to archive brief');
    });
  });

  describe('exportAsJson', () => {
    it('produces valid StoryBrief-shaped JSON with camelCase keys', () => {
      const json = store.exportAsJson(SAMPLE_FULL);
      const parsed = JSON.parse(json);

      expect(parsed.brief).toBe(SAMPLE_FULL.brief);
      expect(parsed.targetAge).toBe(SAMPLE_FULL.target_age);
      expect(parsed.timeBudget).toBe(SAMPLE_FULL.time_budget);
      expect(parsed.titleHint).toBe(SAMPLE_FULL.title_hint);
      expect(parsed.artStyle).toBe(SAMPLE_FULL.art_style);
      expect(parsed.mustInclude).toEqual(SAMPLE_FULL.must_include);
      expect(parsed.culprits).toBe(SAMPLE_FULL.culprits);
      expect(parsed.redHerringTrails).toBe(SAMPLE_FULL.red_herring_trails);
      expect(parsed.coverUps).toBe(SAMPLE_FULL.cover_ups);
      expect(parsed.eliminationComplexity).toBe(SAMPLE_FULL.elimination_complexity);
    });

    it('omits null optional fields from JSON', () => {
      const minimal: BriefFull = {
        ...SAMPLE_FULL,
        time_budget: null,
        title_hint: null,
        art_style: null,
        must_include: [],
        culprits: null,
        suspects: null,
        witnesses: null,
        locations: null,
        red_herring_trails: null,
        cover_ups: null,
        elimination_complexity: null,
      };

      const json = store.exportAsJson(minimal);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual({
        brief: minimal.brief,
        targetAge: minimal.target_age,
      });
      expect(parsed).not.toHaveProperty('timeBudget');
      expect(parsed).not.toHaveProperty('titleHint');
      expect(parsed).not.toHaveProperty('mustInclude');
    });
  });

  describe('duplicate flow', () => {
    it('prepareDuplicate stores data and consumeDuplicate clears it', () => {
      store.prepareDuplicate(SAMPLE_FULL);

      expect(store.pendingDuplicate).toBeTruthy();
      expect(store.pendingDuplicate!.id).toBe('brief-1');

      const consumed = store.consumeDuplicate();

      expect(consumed).toBeTruthy();
      expect(consumed!.id).toBe('brief-1');
      expect(store.pendingDuplicate).toBeNull();
    });

    it('consumeDuplicate returns null when nothing pending', () => {
      expect(store.consumeDuplicate()).toBeNull();
    });
  });

  describe('clearActive', () => {
    it('resets activeBrief and error', () => {
      store.activeBrief = SAMPLE_FULL;
      store.error = 'some error';

      store.clearActive();

      expect(store.activeBrief).toBeNull();
      expect(store.error).toBeNull();
    });
  });
});
