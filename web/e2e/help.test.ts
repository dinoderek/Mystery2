import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createNarrationEvent,
  createGameStartResponse,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({ json: EMPTY_CATALOG });
  });

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
    });
  });

  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: createGameStartResponse({
        narration_events: [
          createNarrationEvent({
            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
          }),
        ],
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
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
      page.getByText(/Commands: move to\/go to <location>, talk to <character>, search, accuse \[statement\], locations, characters, help, quit/),
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
