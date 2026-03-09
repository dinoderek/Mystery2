import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

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
      page.getByText(/Commands: move to\/go to <location>, talk to <character>, search, accuse <character>, locations, characters, help, quit/),
    ).toBeVisible();
  });

  test('sends player_input payload when asking in talk mode', async ({ page }) => {
    let talkCalls = 0;
    let askCalls = 0;
    let askPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-talk*', async (route) => {
      talkCalls += 1;
      await route.fulfill({
        json: {
          narration: 'Mayor Fox nods and listens carefully.',
          mode: 'talk',
          time_remaining: 9,
          current_talk_character: 'Mayor',
        },
      });
    });

    await page.route('**/functions/v1/game-ask*', async (route) => {
      askCalls += 1;
      askPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          narration: 'Mayor Fox answers your question.',
          mode: 'talk',
          time_remaining: 8,
          current_talk_character: 'Mayor',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox nods and listens carefully.')).toBeVisible();

    await input.fill('Where were you?');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox answers your question.')).toBeVisible();

    expect(talkCalls).toBe(1);
    expect(askCalls).toBe(1);
    expect(askPayload?.player_input).toBe('Where were you?');
    expect(askPayload && 'question' in askPayload).toBe(false);
  });

  test('routes accuse-mode free text to game-accuse reasoning (not game-ask)', async ({ page }) => {
    let accuseCalls = 0;
    let askCalls = 0;
    let secondAccusePayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-ask*', async (route) => {
      askCalls += 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unexpected game-ask call' }),
      });
    });

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      accuseCalls += 1;
      const payload = route.request().postDataJSON() as Record<string, unknown>;

      if (accuseCalls === 1) {
        await route.fulfill({
          json: {
            narration: 'You accuse Mayor Fox. Explain your reasoning.',
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
          },
        });
        return;
      }

      secondAccusePayload = payload;
      await route.fulfill({
        json: {
          narration: 'Case closed.',
          mode: 'ended',
          result: 'win',
          follow_up_prompt: null,
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('accuse mayor');
    await input.press('Enter');
    await expect(page.getByText('You accuse Mayor Fox. Explain your reasoning.')).toBeVisible();

    await input.fill('He had crumbs on his coat.');
    await input.press('Enter');
    await expect(page.getByText('Case closed.')).toBeVisible();
    await expect(page.getByTestId('accusation-end-state')).toBeVisible();
    await expect(page.getByText('[ CASE SOLVED ]')).toBeVisible();
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();
    await expect(input).toHaveCount(0);

    await page.keyboard.press('x');
    await expect(page).toHaveURL(/\/$/);

    expect(accuseCalls).toBe(2);
    expect(askCalls).toBe(0);
    expect(secondAccusePayload?.player_reasoning).toBe('He had crumbs on his coat.');
  });

  test('shows failure end-state and returns to list on any key', async ({ page }) => {
    let accuseCalls = 0;

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      accuseCalls += 1;

      if (accuseCalls === 1) {
        await route.fulfill({
          json: {
            narration: 'You accuse Mayor Fox. Explain your reasoning.',
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          narration: 'The accusation fails.',
          mode: 'ended',
          result: 'lose',
          follow_up_prompt: null,
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('accuse mayor');
    await input.press('Enter');
    await expect(page.getByText('You accuse Mayor Fox. Explain your reasoning.')).toBeVisible();

    await input.fill('My theory is weak.');
    await input.press('Enter');
    await expect(page.getByText('The accusation fails.')).toBeVisible();
    await expect(page.getByText('[ CASE UNSOLVED ]')).toBeVisible();
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

    await page.keyboard.press('z');
    await expect(page).toHaveURL(/\/$/);
  });

  test('keeps parsing narrator reasoning across multiple accuse rounds', async ({ page }) => {
    let accuseCalls = 0;
    let askCalls = 0;
    let moveCalls = 0;
    let talkCalls = 0;
    let searchCalls = 0;
    const accusePayloads: Record<string, unknown>[] = [];

    await page.route('**/functions/v1/game-ask*', async (route) => {
      askCalls += 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unexpected game-ask call' }),
      });
    });

    await page.route('**/functions/v1/game-move*', async (route) => {
      moveCalls += 1;
      await route.fulfill({ json: { narration: 'unexpected move call' } });
    });

    await page.route('**/functions/v1/game-talk*', async (route) => {
      talkCalls += 1;
      await route.fulfill({ json: { narration: 'unexpected talk call' } });
    });

    await page.route('**/functions/v1/game-search*', async (route) => {
      searchCalls += 1;
      await route.fulfill({ json: { narration: 'unexpected search call' } });
    });

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      accuseCalls += 1;
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      accusePayloads.push(payload);

      if (accuseCalls === 1) {
        await route.fulfill({
          json: {
            narration: 'You accuse Mayor Fox. Explain your reasoning.',
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
          },
        });
        return;
      }

      if (accuseCalls === 2) {
        await route.fulfill({
          json: {
            narration: 'I need stronger evidence. Keep explaining.',
            mode: 'accuse',
            follow_up_prompt: 'What clue ties the suspect to the scene?',
            result: null,
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          narration: 'Final verdict reached.',
          mode: 'ended',
          result: 'win',
          follow_up_prompt: null,
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('accuse mayor');
    await input.press('Enter');
    await expect(page.getByText('You accuse Mayor Fox. Explain your reasoning.')).toBeVisible();

    await input.fill('go to kitchen because he hid the tray there');
    await input.press('Enter');
    await expect(page.getByText('I need stronger evidence. Keep explaining.')).toBeVisible();

    await input.fill('talk to rosie confirms he was lying');
    await input.press('Enter');
    await expect(page.getByText('Final verdict reached.')).toBeVisible();

    expect(accuseCalls).toBe(3);
    expect(askCalls).toBe(0);
    expect(moveCalls).toBe(0);
    expect(talkCalls).toBe(0);
    expect(searchCalls).toBe(0);
    expect(accusePayloads[1]?.player_reasoning).toBe('go to kitchen because he hid the tray there');
    expect(accusePayloads[2]?.player_reasoning).toBe('talk to rosie confirms he was lying');
  });

  test('shows terminal loading indicator while waiting for backend narration', async ({ page }) => {
    await page.route('**/functions/v1/game-search*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({
        json: {
          narration: 'Search complete.',
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByTestId('terminal-spinner')).toBeVisible();
    await expect(page.getByText('Narrator is thinking...')).toBeVisible();
    await expect(page.getByText('Search complete.')).toBeVisible();
    await expect(page.getByTestId('terminal-spinner')).toHaveCount(0);
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
