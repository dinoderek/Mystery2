import { describe, expect, it } from 'vitest';
import {
  artPaneHeight,
  followVisualViewport,
  isCompact,
  isNearEnd,
  visibleBox,
  type ViewportWindow,
  type VisualViewportLike,
} from './viewport';

class FakeVisualViewport implements VisualViewportLike {
  listeners = new Map<string, Set<() => void>>();
  scale = 1;
  constructor(
    public height: number,
    public offsetTop = 0,
  ) {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: 'resize' | 'scroll') {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

describe('visibleBox', () => {
  it('reads the visual viewport', () => {
    expect(visibleBox({ innerHeight: 800, visualViewport: new FakeVisualViewport(500, 12) })).toEqual({
      height: 500,
      top: 12,
    });
  });

  it('reports the layout viewport while the player is pinched in', () => {
    const visual = new FakeVisualViewport(300, 40);
    visual.scale = 2;
    expect(visibleBox({ innerHeight: 800, visualViewport: visual })).toEqual({ height: 800, top: 0 });
  });

  it('falls back to the window where there is no visual viewport', () => {
    expect(visibleBox({ innerHeight: 800, visualViewport: null })).toEqual({ height: 800, top: 0 });
  });
});

describe('artPaneHeight', () => {
  it('takes its share of a tall screen', () => {
    expect(artPaneHeight(915)).toBe(293);
    expect(artPaneHeight(800)).toBe(256);
  });

  it('gives up height as the screen shrinks, then goes', () => {
    expect(artPaneHeight(700)).toBe(190);
    expect(artPaneHeight(640)).toBe(130);
    expect(artPaneHeight(606)).toBe(96);
    expect(artPaneHeight(605)).toBe(0);
    expect(artPaneHeight(360)).toBe(0);
  });

  it('never goes negative', () => {
    expect(artPaneHeight(100)).toBe(0);
  });
});

describe('isCompact', () => {
  it('is true under 480 px and false from it', () => {
    expect(isCompact(479)).toBe(true);
    expect(isCompact(480)).toBe(false);
  });
});

describe('followVisualViewport', () => {
  it('reports at once, on resize and on scroll, and stops when told', () => {
    const visual = new FakeVisualViewport(800);
    const win: ViewportWindow = { innerHeight: 800, visualViewport: visual };
    const seen: Array<{ height: number; top: number }> = [];

    const stop = followVisualViewport(win, (box) => seen.push(box));
    expect(seen).toEqual([{ height: 800, top: 0 }]);

    visual.height = 420;
    visual.fire('resize');
    visual.offsetTop = 30;
    visual.fire('scroll');
    expect(seen.slice(1)).toEqual([
      { height: 420, top: 0 },
      { height: 420, top: 30 },
    ]);

    stop();
    expect(visual.listenerCount).toBe(0);
    visual.fire('resize');
    expect(seen).toHaveLength(3);
  });

  it('reports once and stops cleanly without a visual viewport', () => {
    const seen: number[] = [];
    const stop = followVisualViewport({ innerHeight: 700, visualViewport: null }, (box) => seen.push(box.height));
    stop();
    expect(seen).toEqual([700]);
  });
});

describe('isNearEnd', () => {
  it('holds at the end and a few pixels short of it', () => {
    expect(isNearEnd({ scrollTop: 500, scrollHeight: 800, clientHeight: 300 })).toBe(true);
    expect(isNearEnd({ scrollTop: 490, scrollHeight: 800, clientHeight: 300 })).toBe(true);
  });

  it('does not hold once the player has scrolled up', () => {
    expect(isNearEnd({ scrollTop: 400, scrollHeight: 800, clientHeight: 300 })).toBe(false);
  });
});
