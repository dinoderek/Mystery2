import { expect, test } from '@playwright/test';
import { readMockCaseGraph } from '../../tests/testkit/src/mock-case';
import { signInAsTestProfile } from './test-profile';

// The real server and the mock narrator: the reference text a player reads is
// narrated for them. The menu draws the titles at once and fills each case's
// line in when it arrives; the notebook's Story is the opening as narrated.
test('the menu shows the titles, then the narrated lines, and the Story is the opening narration', async ({ page }) => {
  await signInAsTestProfile(page, 'narrated-reference', 7);
  const facts = readMockCaseGraph().opening.facts;

  // Hold the lines until the titles are on screen, so the order is seen, not assumed.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/blueprints-list*', async (route) => {
    if (route.request().postDataJSON()?.one_liners === true) await held;
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game', { exact: true })).toBeVisible();
  await page.keyboard.press('1');

  const card = page.locator('[data-testid^="case-card-"]').filter({ hasText: 'Mock Case' });
  await expect(card).toBeVisible();
  const number = (await card.getAttribute('data-testid'))!.replace('case-card-', '');
  await expect(page.getByTestId(`case-line-loading-${number}`)).toBeVisible();
  await expect(card).not.toContainText('[Mock]');

  release();
  await expect(page.getByTestId(`case-line-${number}`)).toHaveText(`[Mock] ${facts[0]}`);
  await expect(page.getByTestId(`case-line-loading-${number}`)).toHaveCount(0);

  const started = page.waitForResponse((response) => response.url().endsWith('/api/game-start'));
  await card.click();
  const opening = (await (await started).json()).narration_events[0].narration_parts[0].text as string;
  expect(opening).toBe(`[Mock] ${facts.join(' ')}`);

  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('input[type="text"]')).toBeEnabled();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: 'STORY' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('notebook-story')).toHaveText(opening);
});
