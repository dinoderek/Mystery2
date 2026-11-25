/** The part of the page the player can see, in CSS pixels. */
export interface ViewportBox {
  height: number;
  /** How far the visible part sits below the top of the layout viewport. */
  top: number;
}

/** What the session screen needs from `window.visualViewport`. */
export interface VisualViewportLike {
  height: number;
  offsetTop: number;
  /** 1 unless the player has pinched in. */
  scale: number;
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void;
}

export interface ViewportWindow {
  innerHeight: number;
  visualViewport: VisualViewportLike | null;
}

/** Under this height the screen drops its chrome: a landscape phone, or any phone with the keyboard up. */
export const COMPACT_BELOW_PX = 480;
/** The art takes this share of the screen, when the text has what it needs. */
const ART_SHARE = 0.32;
/** What the text side needs to stay usable: bars, a few narration lines and the input. */
const TEXT_NEEDS_PX = 510;
/** Less art than this is not worth the space. */
const ART_MIN_PX = 96;

/**
 * What is visible, as the keyboard leaves it. A pinch-zoom also shrinks the
 * visual viewport, but the screen must not re-lay itself out around what the
 * player zoomed into, so a zoomed page reports the layout viewport.
 */
export function visibleBox(win: ViewportWindow): ViewportBox {
  const visual = win.visualViewport;
  if (!visual || visual.scale > 1.01) return { height: win.innerHeight, top: 0 };
  return { height: visual.height, top: visual.offsetTop };
}

/**
 * The art pane's height for a visible height. The art gives up its height
 * first: it takes its share only of what is left once the text has what it
 * needs, and is gone when that is too little to see.
 */
export function artPaneHeight(visibleHeight: number): number {
  const spare = Math.min(visibleHeight * ART_SHARE, visibleHeight - TEXT_NEEDS_PX);
  return spare < ART_MIN_PX ? 0 : Math.round(spare);
}

export function isCompact(visibleHeight: number): boolean {
  return visibleHeight < COMPACT_BELOW_PX;
}

/**
 * Reports the visible box now and whenever it changes. The on-screen keyboard
 * shrinks the visual viewport, and on iOS it leaves the layout viewport as it
 * was, so `dvh` alone does not follow it. Returns the way to stop.
 */
export function followVisualViewport(win: ViewportWindow, onChange: (box: ViewportBox) => void): () => void {
  const report = () => onChange(visibleBox(win));
  const visual = win.visualViewport;
  report();
  visual?.addEventListener('resize', report);
  visual?.addEventListener('scroll', report);
  return () => {
    visual?.removeEventListener('resize', report);
    visual?.removeEventListener('scroll', report);
  };
}

/** Whether a scroll area rests at its end, give or take a few pixels, so a resize should keep it there. */
export function isNearEnd(area: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return area.scrollHeight - area.scrollTop - area.clientHeight < 24;
}
