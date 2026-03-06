import { expect, test, type Page } from '@playwright/test';

const baseState = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }, { name: 'Barn' }],
  characters: [
    { first_name: 'Rosie', last_name: 'Jones', location_name: 'Kitchen' },
    { first_name: 'Mayor', last_name: 'Fox', location_name: 'Kitchen' },
    { first_name: 'Bob', last_name: 'Smith', location_name: 'Garden' },
  ],
  time_remaining: 10,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
  clues: [],
  narration: 'You enter the kitchen.',
  history: [],
};

async function bootstrapSession(page: Page) {
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

test.describe('Command Input', () => {
  test('accepts movement aliases and submits backend command', async ({ page }) => {
    let moveCalls = 0;

    await page.route('**/functions/v1/game-move*', async (route) => {
      if (route.request().method() === 'POST') {
        moveCalls += 1;
      }

      await route.fulfill({
        json: {
          narration: 'You travel to the garden.',
          current_location: 'Garden',
          visible_characters: ['Bob'],
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('travel to garden');
    await input.press('Enter');

    await expect(page.getByText('You travel to the garden.')).toBeVisible();
    expect(moveCalls).toBe(1);
  });

  test('blocks backend call for missing movement target', async ({ page }) => {
    let moveCalls = 0;

    await page.route('**/functions/v1/game-move*', async (route) => {
      if (route.request().method() === 'POST') {
        moveCalls += 1;
      }
      await route.fulfill({ json: { narration: 'unexpected' } });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go');
    await input.press('Enter');

    await expect(page.getByText(/Where to\? Try:/)).toBeVisible();
    expect(moveCalls).toBe(0);
  });

  test('blocks backend call for invalid movement target and shows suggestions', async ({ page }) => {
    let moveCalls = 0;

    await page.route('**/functions/v1/game-move*', async (route) => {
      if (route.request().method() === 'POST') {
        moveCalls += 1;
      }
      await route.fulfill({ json: { narration: 'unexpected' } });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go to zyx');
    await input.press('Enter');

    await expect(
      page.getByText(/"zyx" is not a valid destination\. Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox\./),
    ).toBeVisible();
    expect(moveCalls).toBe(0);
  });

  test('supports locations and characters list commands', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');

    await input.fill('locations');
    await input.press('Enter');
    await expect(page.getByText(/Locations:/)).toBeVisible();

    await input.fill('characters');
    await input.press('Enter');
    await expect(page.getByText(/Characters here: Rosie Jones, Mayor Fox/)).toBeVisible();
  });

  test('shows inline guidance for unrecognized commands', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('jump over fence');
    await input.press('Enter');

    await expect(
      page.getByText(/Commands: go, talk, search, accuse, locations, characters, help, quit/),
    ).toBeVisible();
  });

  test('retries transient backend failures and succeeds', async ({ page }) => {
    let searchCalls = 0;

    await page.route('**/functions/v1/game-search*', async (route) => {
      if (route.request().method() === 'POST') {
        searchCalls += 1;
      }

      if (searchCalls < 3) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporary outage' }),
        });
        return;
      }

      await route.fulfill({
        json: {
          narration: 'Recovered after retry.',
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/Connection issue\. Retrying/)).toBeVisible();
    await expect(page.getByText('Recovered after retry.')).toBeVisible();
    expect(searchCalls).toBe(3);
  });

  test('shows manual retry affordance after retry exhaustion', async ({ page }) => {
    let searchCalls = 0;

    await page.route('**/functions/v1/game-search*', async (route) => {
      if (route.request().method() === 'POST') {
        searchCalls += 1;
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Service unavailable' }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/Request failed after 3 attempts/)).toBeVisible();
    await expect(page.getByTestId('retry-last-command')).toBeVisible();
    expect(searchCalls).toBe(3);
  });

  test('does not retry permanent 4xx errors', async ({ page }) => {
    let searchCalls = 0;

    await page.route('**/functions/v1/game-search*', async (route) => {
      if (route.request().method() === 'POST') {
        searchCalls += 1;
      }

      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid game state' }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/Request failed:/)).toBeVisible();
    expect(searchCalls).toBe(1);
  });
});
