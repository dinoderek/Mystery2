import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  characterSpeaker,
  narrationResponse,
  BASE_GAME_STATE as baseState,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: {
        in_progress: [],
        completed: [],
        counts: { in_progress: 0, completed: 0 },
      },
    });
  });

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
        narration_events: [
          {
            sequence: 1,
            event_type: 'start',
            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
          },
        ],
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
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
          ...narrationResponse('You travel to the garden.', narratorSpeaker),
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
    await expect(page.locator('[data-speaker-kind="investigator"]').last()).toContainText('You:');
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');
    expect(moveCalls).toBe(1);
  });

  test('renders move/talk side imagery and falls back to placeholder when image link fails', async ({ page }) => {
    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse(
            'You travel to the garden.',
            narratorSpeaker,
            'mock-blueprint.location-garden.png',
          ),
          current_location: 'Garden',
          visible_characters: ['Bob'],
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await page.route('**/functions/v1/game-talk*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse(
            'Bob greets you by the flower beds.',
            narratorSpeaker,
            'mock-blueprint.character-bob.png',
          ),
          mode: 'talk',
          time_remaining: 8,
          current_talk_character: 'Bob',
        },
      });
    });

    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      const payload = route.request().postDataJSON() as { image_id?: string };

      if (payload.image_id === 'mock-blueprint.location-garden.png') {
        await route.fulfill({
          json: {
            image_id: 'mock-blueprint.location-garden.png',
            signed_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
            expires_at: '2099-01-01T00:00:00.000Z',
          },
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Image not found' }),
      });
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
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
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
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
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
      page.getByText(/Commands: move to\/go to <location>, talk to <character>, search, accuse \[statement\], locations, characters, help, quit/),
    ).toBeVisible();
    await expect(page.locator('[data-speaker-kind="system"]').last()).toContainText('System:');
  });

  test('sends player_input payload when asking in talk mode', async ({ page }) => {
    let talkCalls = 0;
    let askCalls = 0;
    let askPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-talk*', async (route) => {
      talkCalls += 1;
      await route.fulfill({
        json: {
          ...narrationResponse('Mayor Fox nods and listens carefully.', narratorSpeaker),
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
          ...narrationResponse('Mayor Fox answers your question.', characterSpeaker('Mayor')),
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
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');

    await input.fill('Where were you?');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox answers your question.')).toBeVisible();
    const characterLine = page.locator('[data-speaker-kind="character"]').last();
    await expect(characterLine).toContainText('Mayor:');
    await expect(characterLine).toHaveClass(/speaker-character-generic/);

    expect(talkCalls).toBe(1);
    expect(askCalls).toBe(1);
    expect(askPayload?.player_input).toBe('Where were you?');
    expect(askPayload && 'question' in askPayload).toBe(false);
  });

  test('sends character_id (not character_name) to game-talk endpoint', async ({ page }) => {
    let talkPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-talk*', async (route) => {
      talkPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...narrationResponse('Mayor Fox greets you.', narratorSpeaker),
          mode: 'talk',
          time_remaining: 9,
          current_talk_character: 'char-mayor',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox greets you.')).toBeVisible();

    expect(talkPayload).not.toBeNull();
    expect(talkPayload?.character_id).toBe('char-mayor');
    expect(talkPayload).not.toHaveProperty('character_name');
    expect(talkPayload?.game_id).toBe('g1');
  });

  test('sends destination to game-move endpoint', async ({ page }) => {
    let movePayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-move*', async (route) => {
      movePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...narrationResponse('You travel to the garden.', narratorSpeaker),
          current_location: 'Garden',
          visible_characters: ['Bob'],
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('go to garden');
    await input.press('Enter');
    await expect(page.getByText('You travel to the garden.')).toBeVisible();

    expect(movePayload).not.toBeNull();
    expect(movePayload?.destination).toBe('loc-garden');
    expect(movePayload?.game_id).toBe('g1');
  });

  test('sends game_id to game-search endpoint', async ({ page }) => {
    let searchPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-search*', async (route) => {
      searchPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...narrationResponse('You search the kitchen carefully.', narratorSpeaker),
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('You search the kitchen carefully.')).toBeVisible();

    expect(searchPayload).not.toBeNull();
    expect(searchPayload?.game_id).toBe('g1');
  });

  test('sends game_id to game-end-talk endpoint', async ({ page }) => {
    let endTalkPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-talk*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse('Mayor Fox greets you.', narratorSpeaker),
          mode: 'talk',
          time_remaining: 9,
          current_talk_character: 'char-mayor',
        },
      });
    });

    await page.route('**/functions/v1/game-end-talk*', async (route) => {
      endTalkPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...narrationResponse('You say goodbye to Mayor Fox.', narratorSpeaker),
          mode: 'explore',
          time_remaining: 9,
          current_talk_character: null,
        },
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText('Mayor Fox greets you.')).toBeVisible();

    await input.fill('bye');
    await input.press('Enter');
    await expect(page.getByText('You say goodbye to Mayor Fox.')).toBeVisible();

    expect(endTalkPayload).not.toBeNull();
    expect(endTalkPayload?.game_id).toBe('g1');
  });

  test('renders one generic style class for all character speakers', async ({ page }) => {
    let activeCharacter = 'Mayor';

    await page.route('**/functions/v1/game-talk*', async (route) => {
      const payload = route.request().postDataJSON() as { character_id?: string };
      activeCharacter = payload.character_id === 'char-rosie' ? 'Rosie' : 'Mayor';
      await route.fulfill({
        json: {
          ...narrationResponse(`${activeCharacter} joins the conversation.`, narratorSpeaker),
          mode: 'talk',
          time_remaining: 9,
          current_talk_character: activeCharacter,
        },
      });
    });

    await page.route('**/functions/v1/game-ask*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse(`${activeCharacter} responds to your question.`, characterSpeaker(activeCharacter)),
          mode: 'talk',
          time_remaining: 8,
          current_talk_character: activeCharacter,
        },
      });
    });

    await page.route('**/functions/v1/game-end-talk*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse('Conversation ended.', narratorSpeaker),
          mode: 'explore',
          time_remaining: 8,
          current_talk_character: null,
        },
      });
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

    const characterRows = page.locator('[data-speaker-kind="character"]');
    await expect(characterRows).toHaveCount(2);
    const classList = await characterRows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('class') ?? ''),
    );
    expect(new Set(classList).size).toBe(1);
    expect(classList[0]).toContain('speaker-character-generic');
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
            ...narrationResponse('You accuse Mayor Fox. Explain your reasoning.', narratorSpeaker),
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
            time_remaining: 8,
          },
        });
        return;
      }

      secondAccusePayload = payload;
      await route.fulfill({
        json: {
          ...narrationResponse('Case closed.', narratorSpeaker),
          mode: 'ended',
          result: 'win',
          follow_up_prompt: null,
          time_remaining: 8,
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
            ...narrationResponse('You accuse Mayor Fox. Explain your reasoning.', narratorSpeaker),
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
            time_remaining: 8,
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          ...narrationResponse('The accusation fails.', narratorSpeaker),
          mode: 'ended',
          result: 'lose',
          follow_up_prompt: null,
          time_remaining: 8,
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

  test('ends the session on quit and returns to list on any key', async ({ page }) => {
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
    let askCalls = 0;
    let accuseCalls = 0;

    await page.route('**/functions/v1/game-talk*', async (route) => {
      await route.fulfill({
        json: {
          ...narrationResponse('Mayor Fox greets you with a wry smile.', narratorSpeaker),
          mode: 'talk',
          time_remaining: 1,
          current_talk_character: 'Mayor',
        },
      });
    });

    await page.route('**/functions/v1/game-ask*', async (route) => {
      askCalls += 1;
      await route.fulfill({
        json: {
          narration_parts: [
            {
              text: 'Mayor Fox answers, but a nagging doubt remains.',
              speaker: characterSpeaker('Mayor'),
            },
            {
              text: 'Time is up; accusation begins now.',
              speaker: narratorSpeaker,
            },
          ],
          mode: 'accuse',
          time_remaining: 0,
          current_talk_character: null,
          follow_up_prompt: 'Why do you think Mayor Fox did it?',
        },
      });
    });

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      accuseCalls += 1;
      await route.fulfill({
        json: {
          ...narrationResponse('Your reasoning is noted.', narratorSpeaker),
          mode: 'ended',
          result: 'win',
          follow_up_prompt: null,
          time_remaining: 0,
        },
      });
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
    expect(askCalls).toBe(1);
    expect(accuseCalls).toBe(1);
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
            ...narrationResponse('You accuse Mayor Fox. Explain your reasoning.', narratorSpeaker),
            mode: 'accuse',
            follow_up_prompt: 'Why do you think Mayor Fox did it?',
            result: null,
            time_remaining: 8,
          },
        });
        return;
      }

      if (accuseCalls === 2) {
        await route.fulfill({
          json: {
            ...narrationResponse('I need stronger evidence. Keep explaining.', narratorSpeaker),
            mode: 'accuse',
            follow_up_prompt: 'What clue ties the suspect to the scene?',
            result: null,
            time_remaining: 8,
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          ...narrationResponse('Final verdict reached.', narratorSpeaker),
          mode: 'ended',
          result: 'win',
          follow_up_prompt: null,
          time_remaining: 8,
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
          ...narrationResponse('Search complete.', narratorSpeaker),
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
          ...narrationResponse('Recovered after retry.', narratorSpeaker),
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
