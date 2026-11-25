import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { listOnlyMockCase } from './session-helpers';
import {
  createSessionCatalog,
  createSessionSummary,
} from '../../tests/testkit/src/fixtures';

// A menu row does the same whether it is reached by its key or by a click, on
// Desktop Chrome, where both exist. The phone and tablet projects tap
// (`touch/menus.test.ts`).

async function openMenu(page: Page) {
  await signInAsTestProfile(page, 'taps');
  await listOnlyMockCase(page);
  await page.route('**/api/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        in_progress: [createSessionSummary({ mystery_title: 'The Missing Honey Cakes' })],
        counts: { in_progress: 1, completed: 0 },
      }),
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('menu-row-2')).toBeEnabled();
}

for (const how of ['key', 'click'] as const) {
  test.describe(`menu rows by ${how}`, () => {
    test.beforeEach(async ({ page }) => {
      await openMenu(page);
    });

    test('the new-game row opens the case list and back returns to the menu', async ({ page }) => {
      if (how === 'key') await page.keyboard.press('1');
      else await page.getByTestId('menu-row-1').click();
      await expect(page.getByTestId('case-card-1')).toBeVisible();

      if (how === 'key') await page.keyboard.press('b');
      else await page.getByTestId('back-button').click();
      await expect(page.getByTestId('menu-row-1')).toBeVisible();
    });

    test('a case card starts the case', async ({ page }) => {
      if (how === 'key') {
        await page.keyboard.press('1');
        await expect(page.getByTestId('case-card-1')).toBeVisible();
        await page.keyboard.press('1');
      } else {
        await page.getByTestId('menu-row-1').click();
        await page.getByTestId('case-card-1').click();
      }
      await expect(page).toHaveURL(/\/session$/);
    });

    test('the in-progress row opens the list and back returns to the menu', async ({ page }) => {
      if (how === 'key') await page.keyboard.press('2');
      else await page.getByTestId('menu-row-2').click();
      await expect(page).toHaveURL(/\/sessions\/in-progress$/);
      await expect(page.getByTestId('session-row-1')).toContainText('The Missing Honey Cakes');

      if (how === 'key') await page.keyboard.press('b');
      else await page.getByTestId('back-button').click();
      await expect(page).toHaveURL(/\/$/);
    });
  });
}

test('a disabled row does nothing on click or key', async ({ page }) => {
  await openMenu(page);

  await expect(page.getByTestId('menu-row-3')).toBeDisabled();
  await page.getByTestId('menu-row-3').click({ force: true });
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/$/);
});
