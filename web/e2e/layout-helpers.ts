import { expect, type Page } from '@playwright/test';

/** The smallest a finger-sized control may be, in its smaller dimension. */
export const MIN_TARGET_PX = 44;

/**
 * Nothing on the screen scrolls sideways: not the page, which a fixed screen
 * never widens, so also not any box that sticks out past the right edge, and
 * not any scroll area that holds something wider than itself.
 */
export async function expectNoSidewaysScroll(page: Page, where: string) {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width) out.push('the page');
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      const name = `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 24)}"`;
      if (box.width > 0 && box.right > width + 0.5) out.push(`${name} ends at ${Math.round(box.right)}`);
      if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth) {
        out.push(`${name} scrolls sideways`);
      }
    }
    return out;
  });
  expect(found, `${where}: something runs past the right edge`).toEqual([]);
}

/**
 * Every visible, enabled button, link and input is at least `MIN_TARGET_PX` in
 * its smaller dimension. A control that is not displayed, such as one in a
 * closed overlay, is not counted; one scrolled out of view is.
 */
export async function expectTapTargets(page: Page, where: string) {
  const small = await page.evaluate((minimum) => {
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"]';
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if ((element as HTMLButtonElement).disabled) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (Math.min(box.width, box.height) < minimum - 0.5) {
        const label = (element.textContent ?? element.getAttribute('aria-label') ?? '').trim().slice(0, 30);
        found.push(`${element.tagName.toLowerCase()} "${label}" ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return found;
  }, MIN_TARGET_PX);
  expect(small, `${where}: controls under ${MIN_TARGET_PX}px`).toEqual([]);
}

/** Both checks, for one screen. */
export async function expectScreenFits(page: Page, where: string) {
  await expectNoSidewaysScroll(page, where);
  await expectTapTargets(page, where);
}

/**
 * True when the element's box lies inside what is visible: the visual
 * viewport, which the on-screen keyboard shrinks and which can sit below the
 * top of the layout viewport.
 */
export async function isInsideViewport(page: Page, target: string | { locator: string }): Promise<boolean> {
  const locator = typeof target === 'string' ? page.getByTestId(target) : page.locator(target.locator);
  const box = await locator.boundingBox();
  const visible = await page.evaluate(() => ({
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.visualViewport?.width ?? window.innerWidth,
  }));
  return (
    box !== null &&
    box.y >= visible.top &&
    box.y + box.height <= visible.top + visible.height &&
    box.x >= 0 &&
    box.x + box.width <= visible.width
  );
}
