import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSceneManifest, sceneForPage } from './scene-selection';
import type { SessionPage } from './session-pages';
import { callApiGet } from '../api/client';
import {
  createSceneManifest,
  createProceduralScene,
} from '../../../../tests/testkit/src/fixtures';

vi.mock('../api/client', () => ({ callApiGet: vi.fn() }));
const recipe = createProceduralScene();
const manifest = createSceneManifest({ scenes: [recipe] });
const page: SessionPage = {
  index: 0,
  kind: 'location',
  title: null,
  fallbackLabel: 'Kitchen',
  imageId: null,
  locationId: recipe.location_id,
  events: [],
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(callApiGet).mockReset();
});

describe('scene artwork', () => {
  it('selects historical scenery while preserving portraits and missing-art fallbacks', () => {
    expect(sceneForPage(manifest, page)).toBe(manifest.scenes[0]);
    expect(
      sceneForPage(manifest, { ...page, locationId: 'another-place' }),
    ).toBeNull();
    expect(sceneForPage(manifest, { ...page, kind: 'conversation' })).toBe(
      manifest.scenes[0],
    );
    expect(
      sceneForPage(manifest, {
        ...page,
        kind: 'conversation',
        imageId: 'portrait.png',
      }),
    ).toBeNull();
    expect(sceneForPage(manifest, { ...page, kind: 'opening' })).toBeNull();
    expect(sceneForPage(manifest, null)).toBeNull();
    expect(sceneForPage(null, page)).toBeNull();
  });
  it('validates the public response against the requested case', async () => {
    vi.mocked(callApiGet).mockResolvedValue({ data: manifest, error: null });
    expect(await loadSceneManifest(manifest.blueprint_id)).toEqual(manifest);
    expect(callApiGet).toHaveBeenCalledWith('blueprint-scenes', {
      blueprint_id: manifest.blueprint_id,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await loadSceneManifest('a3f5c9d1-4e7b-4a2c-9f81-6b0d2e5a7c34'),
    ).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('logs a transport or contract failure once and returns the image fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(callApiGet).mockResolvedValueOnce({
      data: null,
      error: { message: 'Offline' },
    });
    expect(await loadSceneManifest(manifest.blueprint_id)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockClear();
    vi.mocked(callApiGet).mockResolvedValueOnce({
      data: { scenes: 'broken' },
      error: null,
    });
    expect(await loadSceneManifest(manifest.blueprint_id)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
