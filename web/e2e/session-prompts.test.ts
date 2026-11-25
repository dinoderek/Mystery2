import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { playedTurn, stubTurns } from './session-helpers';
import {
  EMPTY_CATALOG,
  NARRATOR_SPEAKER,
  createBlueprintSummary,
  createGameEnterResponse,
  createGameStartResponse,
} from '../../tests/testkit/src/fixtures';

// Desktop Chrome: the prompt buttons are an addition, and every key still works.

async function startCase(page: Page): Promise<{ enters: () => number }> {
  await signInAsTestProfile(page);
  await page.route('**/api/game-sessions-list*', (route) => route.fulfill({ json: EMPTY_CATALOG }));
  await page.route('**/api/blueprints-list*', (route) =>
    route.fulfill({ json: { blueprints: [createBlueprintSummary({ title: 'B1' })] } }),
  );
  await page.route('**/api/game-start*', (route) => route.fulfill({ json: createGameStartResponse() }));

  let entered = 0;
  await page.route('**/api/game-enter*', async (route) => {
    entered += 1;
    await route.fulfill({
      json: createGameEnterResponse({
        narration_parts: [{ text: 'You enter the kitchen.', speaker: NARRATOR_SPEAKER, image_id: null }],
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByTestId('menu-row-1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByTestId('case-card-1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  return { enters: () => entered };
}

test.describe('Session prompts and the input, with a keyboard', () => {
  for (const key of ['Enter', 'Space']) {
    test(`${key} on the focused begin button starts the case once`, async ({ page }) => {
      const { enters } = await startCase(page);

      await page.getByTestId('begin-investigation-prompt').focus();
      await page.keyboard.press(key);

      await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();
      await expect(page.getByText('You enter the kitchen.')).toBeVisible();
      expect(enters()).toBe(1);
    });
  }

  test('a click on the begin button starts the case once', async ({ page }) => {
    const { enters } = await startCase(page);

    await page.getByTestId('begin-investigation-prompt').click();

    await expect(page.getByText('You enter the kitchen.')).toBeVisible();
    expect(enters()).toBe(1);
  });

  test('the input is focused at once, and Enter and [ SEND ] both submit', async ({ page }) => {
    const requests = await stubTurns(page, (_request, count) =>
      playedTurn('search', `Search ${count}.`),
    );
    await startCase(page);
    await page.keyboard.press('x');

    const input = page.locator('input[type="text"]');
    await expect(input).toBeFocused();

    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('Search 1.')).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill('search the shelf');
    await page.getByTestId('send-button').click();
    await expect(page.getByText('Search 2.')).toBeVisible();
    await expect(input).toBeFocused();

    expect(requests.map((request) => request.input)).toEqual(['search', 'search the shelf']);
  });

  test('Tab still toggles the notebook from the end state, and any other key leaves', async ({ page }) => {
    await stubTurns(page, () =>
      playedTurn('accuse_resolved', 'Case closed.', {
        state: { mode: 'ended', time_remaining: 0 },
        result: 'win',
      }),
    );
    await startCase(page);
    await page.keyboard.press('x');

    const input = page.locator('input[type="text"]');
    await input.fill('accuse Rosie because of the timeline');
    await input.press('Enter');
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

    const notebook = page.getByRole('dialog', { name: 'CASE NOTEBOOK' });
    await page.keyboard.press('Tab');
    await expect(notebook).toBeVisible();
    await expect(notebook.getByText('Tab close')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(notebook).toBeHidden();
    await expect(page).toHaveURL(/\/session$/);

    await page.keyboard.press('x');
    await expect(page).toHaveURL(/\/$/);
  });
});
