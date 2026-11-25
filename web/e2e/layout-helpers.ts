import { expect, type Page } from '@playwright/test';

/** The smallest a finger-sized control may be, in its smaller dimension. */
export const MIN_TARGET_PX = 44;

/** Nothing on the screen scrolls the page sideways. */
export async function expectNoSidewaysScroll(page: Page, where: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(innerWidth);
}

/**
 * Every visible, enabled button, link and input is at least `MIN_TARGET_PX` in
 * its smaller dimension. A control hidden by a scroll area or a closed overlay
 * is not visible and is not counted.
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

/** True when the element's box lies inside the visible viewport. */
export async function isInsideViewport(page: Page, testId: string | { locator: string }): Promise<boolean> {
  const locator = typeof testId === 'string' ? page.getByTestId(testId) : page.locator(testId.locator);
  const box = await locator.boundingBox();
  const viewport = await page.evaluate(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.visualViewport?.width ?? window.innerWidth,
  }));
  return box !== null && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
}
