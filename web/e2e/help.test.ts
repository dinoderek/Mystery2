import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const baseState = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }],
  characters: [{ first_name: 'Rosie', last_name: 'Jones', location_name: 'Kitchen' }],
  time_remaining: 10,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
  clues: [],
  narration: 'You enter the kitchen.',
  history: [],
};

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: {
        blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }],
      },
    });
  });

  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: 'g1',
        state: baseState,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('B1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
}

test.describe('Help and inline guidance', () => {
  test('keeps unrecognized guidance inline and brief', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('fly to moon');
    await input.press('Enter');

    await expect(
      page.getByText(/Commands: move to\/go to <location>, talk to <character>, search, accuse <character>, locations, characters, help, quit/),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'COMMAND REFERENCE' })).toBeHidden();
  });

  test('opens detailed help modal with aliases on help command', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('help');
    await input.press('Enter');

    await expect(page.getByRole('heading', { name: 'COMMAND REFERENCE' })).toBeVisible();
    await expect(page.getByText(/travel to/)).toBeVisible();
    await expect(page.getByText(/where can i go/)).toBeVisible();
    await expect(page.getByText(/quit \/ exit/)).toBeVisible();

    await page.locator('button:has-text("[ CLOSE ]")').click();
    await expect(page.getByRole('heading', { name: 'COMMAND REFERENCE' })).toBeHidden();
  });
});
