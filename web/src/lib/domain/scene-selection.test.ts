import { describe, expect, it } from 'vitest';
import { hasLighthouseScene, LIGHTHOUSE_BLUEPRINT_ID } from './scene-selection';
import type { SessionPage } from './session-pages';

const page: SessionPage = {
  index: 0,
  kind: 'location',
  title: null,
  fallbackLabel: 'Lantern Room',
  imageId: null,
  locationId: 'lantern_room',
  events: [],
};

describe('the authored lighthouse scene', () => {
  it('belongs only to this case and its lantern-room location pages', () => {
    expect(hasLighthouseScene(LIGHTHOUSE_BLUEPRINT_ID, page)).toBe(true);
    expect(hasLighthouseScene(null, page)).toBe(false);
    expect(hasLighthouseScene('another-case', page)).toBe(false);
    expect(hasLighthouseScene(LIGHTHOUSE_BLUEPRINT_ID, null)).toBe(false);
    expect(
      hasLighthouseScene(LIGHTHOUSE_BLUEPRINT_ID, {
        ...page,
        kind: 'conversation',
      }),
    ).toBe(false);
    expect(
      hasLighthouseScene(LIGHTHOUSE_BLUEPRINT_ID, {
        ...page,
        locationId: 'keepers_cottage',
      }),
    ).toBe(false);
    expect(
      hasLighthouseScene(LIGHTHOUSE_BLUEPRINT_ID, {
        ...page,
        locationId: null,
      }),
    ).toBe(false);
  });
});
