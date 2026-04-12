import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mobileDetect } from './mobile-detect.svelte';

let changeListener: ((e: { matches: boolean }) => void) | null = null;

function mockMatchMedia(matches: boolean) {
  changeListener = null;
  vi.stubGlobal('window', {
    matchMedia: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
        changeListener = cb;
      }),
    }),
  });
}

beforeEach(() => {
  // Reset store state
  mobileDetect.isMobile = false;
  changeListener = null;
});

describe('MobileDetectStore', () => {
  it('defaults isMobile to false', () => {
    expect(mobileDetect.isMobile).toBe(false);
  });

  it('init() reads from matchMedia and sets isMobile to true when matched', () => {
    mockMatchMedia(true);
    mobileDetect.init();
    expect(mobileDetect.isMobile).toBe(true);
  });

  it('init() reads from matchMedia and sets isMobile to false when not matched', () => {
    mockMatchMedia(false);
    mobileDetect.init();
    expect(mobileDetect.isMobile).toBe(false);
  });

  it('init() no-ops when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined);
    mobileDetect.init();
    expect(mobileDetect.isMobile).toBe(false);
  });

  it('change event listener updates isMobile reactively', () => {
    mockMatchMedia(false);
    mobileDetect.init();
    expect(mobileDetect.isMobile).toBe(false);

    // Simulate media query change
    expect(changeListener).not.toBeNull();
    changeListener!({ matches: true });
    expect(mobileDetect.isMobile).toBe(true);

    changeListener!({ matches: false });
    expect(mobileDetect.isMobile).toBe(false);
  });
});
