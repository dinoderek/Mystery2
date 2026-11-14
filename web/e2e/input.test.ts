import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { confirmOpening, playedTurn, stubTurns } from './session-helpers';
import {
  EMPTY_CATALOG,
  characterSpeaker,
  createBlueprintSummary,
  createGameStartResponse,
  createTurnQuitResponse,
  createTurnRefusedResponse,
  createTurnViewResponse,
} from '../../tests/testkit/src/fixtures';

const GAME_ID = '00000000-0000-0000-0000-000000000001';

async function bootstrapSession(page: Page) {
  await signInAsTestProfile(page);

  await page.route('**/api/game-sessions-list*', async (route) => {
    await route.fulfill({ json: EMPTY_CATALOG });
  });

  await page.route('**/api/blueprints-list*', async (route) => {
    await route.fulfill({
      json: {
        blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })],
      },
    });
  });

  await page.route('**/api/game-start*', async (route) => {
    await route.fulfill({
      json: createGameStartResponse({ game_id: GAME_ID }),
    });
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText('B1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
  await confirmOpening(page);
}

test.describe('Command Input', () => {
  test('accepts movement aliases and sends the line as typed', async ({ page }) => {
    const requests = await stubTurns(page, () =>
      playedTurn('move', 'You travel to the garden.', {
        payload: { location_name: 'Garden' },
        state: { location: 'loc-garden' },
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('travel to garden');
    await input.press('Enter');

    await expect(page.getByText('You travel to the garden.')).toBeVisible();
    await expect(page.locator('[data-speaker-kind="investigator"]').last()).toContainText('You:');
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');
    expect(requests).toEqual([{ game_id: GAME_ID, input: 'travel to garden' }]);
  });

  test('renders move/talk side imagery and falls back to placeholder when image link fails', async ({ page }) => {
    await stubTurns(page, ({ input }) =>
      input === 'go to garden'
        ? playedTurn('move', 'You travel to the garden.', {
            image: 'mock-blueprint.location-garden.png',
            payload: { location_name: 'Garden' },
            state: { location: 'loc-garden' },
          })
        : playedTurn('talk', 'Bob greets you by the flower beds.', {
            image: 'mock-blueprint.character-bob.png',
            payload: { character_name: 'Bob' },
            state: { mode: 'talk', time_remaining: 8, location: 'loc-garden', current_talk_character: 'char-bob' },
          }),
    );

    // The garden image resolves; anything else 404s, so the pane falls back to
    // its placeholder without taking the narration flow with it.
    await page.route('**/api/images/**', async (route) => {
      if (route.request().url().includes('mock-blueprint.location-garden.png')) {
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
        });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go to garden');
    await input.press('Enter');

    await expect(page.getByText('You travel to the garden.')).toBeVisible();
    await expect(page.locator('.story-image-panel img')).toBeVisible();

    await input.fill('talk to bob');
    await input.press('Enter');
    await expect(page.getByText('Bob greets you by the flower beds.')).toBeVisible();
  });

  test('shows the hint for a missing movement target', async ({ page }) => {
    await stubTurns(page, () =>
      createTurnRefusedResponse({
        reason: 'missing-target',
        hint: 'Where to? Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox.',
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go');
    await input.press('Enter');

    await expect(page.getByText(/Where to\? Try:/)).toBeVisible();
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
    // The player's own words stay on the screen above the hint.
    await expect(page.locator('[data-speaker-kind="investigator"]').last()).toContainText('go');
  });

  test('shows the hint for an invalid movement target with suggestions', async ({ page }) => {
    await stubTurns(page, () =>
      createTurnRefusedResponse({
        reason: 'invalid-target',
        hint: '"zyx" is not a valid destination. Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox.',
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go to zyx');
    await input.press('Enter');

    await expect(
      page.getByText(/"zyx" is not a valid destination\. Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox\./),
    ).toBeVisible();
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
  });

  test('list commands open the notebook at the matching section', async ({ page }) => {
    await stubTurns(page, ({ input }) =>
      input === 'locations'
        ? createTurnViewResponse({ view: 'locations', section: 'places' })
        : createTurnViewResponse({ view: 'characters', section: 'people' }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');

    await input.fill('locations');
    await input.press('Enter');
    await expect(page.getByRole('tab', { name: 'PLACES' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Everything the retired inline list printed is still here.
    const notebook = page.getByRole('dialog');
    await expect(notebook.getByText('[ you are here ]')).toBeVisible();
    await expect(notebook.getByText('With: Rosie Jones, Mayor Fox')).toBeVisible();
    await expect(notebook.getByText('No one here right now')).toBeVisible();

    await page.keyboard.press('Escape');
    await input.fill('characters');
    await input.press('Enter');
    await expect(page.getByRole('tab', { name: 'PEOPLE' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(notebook.getByText('Rosie Jones')).toBeVisible();
    await expect(notebook.getByText('At the Garden')).toBeVisible();
  });

  test('shows inline guidance for unrecognized commands', async ({ page }) => {
    await stubTurns(page, () =>
      createTurnRefusedResponse({
        reason: 'unrecognized',
        hint: "Commands: move to/go to <location>, talk to <character>, search, accuse [statement], locations, characters, notebook, help, quit. Type 'help' for details.",
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('jump over fence');
    await input.press('Enter');

    await expect(
      page.getByText(/Commands: move to\/go to <location>, talk to <character>, search, accuse \[statement\], locations, characters, notebook, help, quit/),
    ).toBeVisible();
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
  });

  test('sends a question in talk mode as the line typed', async ({ page }) => {
    const requests = await stubTurns(page, ({ input }) =>
      input === 'talk to mayor'
        ? playedTurn('talk', 'Mayor Fox nods and listens carefully.', {
            payload: { character_name: 'Mayor' },
            state: { mode: 'talk', current_talk_character: 'char-mayor' },
          })
        : playedTurn('ask', 'Mayor Fox answers your question.', {
            speaker: characterSpeaker('Mayor'),
            state: { mode: 'talk', time_remaining: 8, current_talk_character: 'char-mayor' },
          }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox nods and listens carefully.')).toBeVisible();
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');

    await input.fill('Where were you?');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox answers your question.')).toBeVisible();
    const characterLine = page.locator('[data-speaker-kind="character"]').last();
    await expect(characterLine).toContainText('Mayor:');
    await expect(characterLine).toHaveClass(/text-t-dialogue-text/);

    expect(requests.map((request) => request.input)).toEqual(['talk to mayor', 'Where were you?']);
    expect(requests.every((request) => request.game_id === GAME_ID)).toBe(true);
  });

  test('sends the name as typed, not a character id', async ({ page }) => {
    const requests = await stubTurns(page, () =>
      playedTurn('talk', 'Mayor Fox greets you.', {
        payload: { character_name: 'Mayor' },
        state: { mode: 'talk', current_talk_character: 'char-mayor' },
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox greets you.')).toBeVisible();

    expect(requests).toEqual([{ game_id: GAME_ID, input: 'talk to mayor' }]);
  });

  test('sends a movement line as typed', async ({ page }) => {
    const requests = await stubTurns(page, () =>
      playedTurn('move', 'You travel to the garden.', {
        payload: { location_name: 'Garden' },
        state: { location: 'loc-garden' },
      }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go to garden');
    await input.press('Enter');
    await expect(page.getByText('You travel to the garden.')).toBeVisible();

    expect(requests).toEqual([{ game_id: GAME_ID, input: 'go to garden' }]);
  });

  test('sends a search line as typed', async ({ page }) => {
    const requests = await stubTurns(page, () => playedTurn('search', 'You search the kitchen carefully.'));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('You search the kitchen carefully.')).toBeVisible();

    expect(requests).toEqual([{ game_id: GAME_ID, input: 'search' }]);
  });

  test('sends the end-of-conversation line as typed', async ({ page }) => {
    const requests = await stubTurns(page, ({ input }) =>
      input === 'talk to mayor'
        ? playedTurn('talk', 'Mayor Fox greets you.', {
            payload: { character_name: 'Mayor' },
            state: { mode: 'talk', current_talk_character: 'char-mayor' },
          })
        : playedTurn('end_talk', 'You say goodbye to Mayor Fox.', {
            payload: { location_name: 'Kitchen' },
            state: { mode: 'explore', time_remaining: 8, current_talk_character: null },
          }),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox greets you.')).toBeVisible();

    await input.fill('bye');
    await input.press('Enter');
    await expect(page.getByText('You say goodbye to Mayor Fox.')).toBeVisible();

    expect(requests.map((request) => request.input)).toEqual(['talk to mayor', 'bye']);
  });

  test('renders one generic style class for all character speakers', async ({ page }) => {
    await stubTurns(page, ({ input }) => {
      switch (input) {
        case 'talk to mayor':
        case 'talk to rosie': {
          const name = input === 'talk to rosie' ? 'Rosie' : 'Mayor';
          return playedTurn('talk', `${name} joins the conversation.`, {
            payload: { character_name: name },
            state: { mode: 'talk', current_talk_character: name === 'Rosie' ? 'char-rosie' : 'char-mayor' },
          });
        }
        case 'bye':
          return playedTurn('end_talk', 'Conversation ended.', {
            payload: { location_name: 'Kitchen' },
            state: { mode: 'explore', time_remaining: 8, current_talk_character: null },
          });
        default: {
          const name = input === 'What did you see?' ? 'Rosie' : 'Mayor';
          return playedTurn('ask', `${name} responds to your question.`, {
            speaker: characterSpeaker(name),
            state: { mode: 'talk', time_remaining: 8, current_talk_character: name === 'Rosie' ? 'char-rosie' : 'char-mayor' },
          });
        }
      }
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await input.fill('Where were you?');
    await input.press('Enter');

    await input.fill('bye');
    await input.press('Enter');
    await input.fill('talk to rosie');
    await input.press('Enter');
    await input.fill('What did you see?');
    await input.press('Enter');

    // Each conversation is its own page, so the two characters are gathered by
    // paging back to the first one rather than reading a single stream.
    const characterRow = page.locator('[data-speaker-kind="character"]');
    await expect(characterRow).toHaveCount(1);
    const rosieClass = await characterRow.getAttribute('class');

    await page.getByTestId('page-prev').click();
    await page.getByTestId('page-prev').click();
    await expect(characterRow).toHaveCount(1);
    const mayorClass = await characterRow.getAttribute('class');

    expect(rosieClass).toBe(mayorClass);
    expect(rosieClass).toContain('text-t-dialogue-text');
  });

  test('sends accuse-mode free text as the line typed', async ({ page }) => {
    const requests = await stubTurns(page, (_request, count) =>
      count === 1
        ? playedTurn('accuse_start', 'You accuse Mayor Fox. Explain your reasoning.', {
            state: { mode: 'accuse', time_remaining: 8 },
          })
        : playedTurn('accuse_resolved', 'Case closed.', {
            state: { mode: 'ended', time_remaining: 8 },
            result: 'win',
          }),
    );

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

    expect(requests.map((request) => request.input)).toEqual(['accuse mayor', 'He had crumbs on his coat.']);
  });

  test('shows failure end-state and returns to list on any key', async ({ page }) => {
    await stubTurns(page, (_request, count) =>
      count === 1
        ? playedTurn('accuse_start', 'You accuse Mayor Fox. Explain your reasoning.', {
            state: { mode: 'accuse', time_remaining: 8 },
          })
        : playedTurn('accuse_resolved', 'The accusation fails.', {
            state: { mode: 'ended', time_remaining: 8 },
            result: 'lose',
          }),
    );

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

  test('ends the session on quit and returns to list on any key', async ({ page }) => {
    await stubTurns(page, () => createTurnQuitResponse());

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('quit');
    await input.press('Enter');

    await expect(page).toHaveURL(/.*\/session/);
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();
    await expect(page.getByText('[ CASE SOLVED ]')).toHaveCount(0);
    await expect(page.getByText('[ CASE UNSOLVED ]')).toHaveCount(0);

    await page.keyboard.press('k');
    await expect(page).toHaveURL(/\/$/);
  });

  test('shows both narration parts for final-turn ask and switches to accuse-mode', async ({ page }) => {
    const requests = await stubTurns(page, ({ input }) => {
      switch (input) {
        case 'talk to mayor':
          return playedTurn('talk', 'Mayor Fox greets you with a wry smile.', {
            payload: { character_name: 'Mayor' },
            state: { mode: 'talk', time_remaining: 1, current_talk_character: 'char-mayor' },
          });
        case 'Where were you?':
          return playedTurn('ask', 'Mayor Fox answers, but a nagging doubt remains.', {
            speaker: characterSpeaker('Mayor'),
            state: { mode: 'accuse', time_remaining: 0, current_talk_character: null },
            after: [{ event_type: 'forced_endgame', text: 'Time is up; accusation begins now.' }],
          });
        default:
          return playedTurn('accuse_round', 'Your reasoning is noted.', {
            state: { mode: 'accuse', time_remaining: 0, current_talk_character: null },
          });
      }
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await input.fill('Where were you?');
    await input.press('Enter');

    await expect(page.getByText('Time is up; accusation begins now.')).toBeVisible();

    const historyLines = await page.locator('.terminal-message').allTextContents();
    const tail = historyLines.slice(-2);
    expect(tail).toEqual([
      'Mayor: Mayor Fox answers, but a nagging doubt remains.',
      'Narrator: Time is up; accusation begins now.',
    ]);

    await input.fill('Mayor Fox hid the crumbs.');
    await input.press('Enter');
    await expect(page.getByText('Your reasoning is noted.')).toBeVisible();
    expect(requests.map((request) => request.input)).toEqual([
      'talk to mayor',
      'Where were you?',
      'Mayor Fox hid the crumbs.',
    ]);
  });

  test('sends every accuse-round line as typed, even one that reads like a command', async ({ page }) => {
    const requests = await stubTurns(page, (_request, count) => {
      if (count === 1) {
        return playedTurn('accuse_start', 'You accuse Mayor Fox. Explain your reasoning.', {
          state: { mode: 'accuse', time_remaining: 8 },
        });
      }
      if (count === 2) {
        return playedTurn('accuse_round', 'I need stronger evidence. Keep explaining.', {
          state: { mode: 'accuse', time_remaining: 8 },
        });
      }
      return playedTurn('accuse_resolved', 'Final verdict reached.', {
        state: { mode: 'ended', time_remaining: 8 },
        result: 'win',
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

    expect(requests.map((request) => request.input)).toEqual([
      'accuse mayor',
      'go to kitchen because he hid the tray there',
      'talk to rosie confirms he was lying',
    ]);
  });

  test('shows terminal loading indicator while waiting for backend narration', async ({ page }) => {
    await page.route('**/api/game-turn*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({ json: playedTurn('search', 'Search complete.') });
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
    const requests = await stubTurns(page, (_request, count) =>
      count < 3
        ? { status: 503, body: { message: 'Temporary outage' } }
        : playedTurn('search', 'Recovered after retry.'),
    );

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/Something went wrong\. Trying again/)).toBeVisible();
    await expect(page.getByText('Recovered after retry.')).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  test('shows manual retry affordance after retry exhaustion', async ({ page }) => {
    const requests = await stubTurns(page, () => ({
      status: 503,
      body: { message: 'Service unavailable' },
    }));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/That did not work, even after 3 tries/)).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  test('does not retry permanent 4xx errors', async ({ page }) => {
    const requests = await stubTurns(page, () => ({
      status: 400,
      body: { message: 'Invalid game state' },
    }));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/Request failed:/)).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  test('shows a turn that lost the race to another like any other failed turn', async ({ page }) => {
    const requests = await stubTurns(page, () => ({
      status: 409,
      body: { error: 'Another turn for this game was saved first' },
    }));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText('Request failed: Another turn for this game was saved first')).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  test('says so, and logs it, when the answer is not one the page can read', async ({ page }) => {
    const logged: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') logged.push(message.text());
    });
    await page.route('**/api/game-turn*', async (route) => {
      await route.fulfill({ json: { kind: 'turn', events: [] } });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText(/not in the shape this page expects/)).toBeVisible();
    expect(logged.some((line) => line.includes('[contract] game-turn'))).toBe(true);
  });
});
