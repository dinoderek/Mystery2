import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const narratorSpeaker = { kind: 'narrator', key: 'narrator', label: 'Narrator' } as const;

test.describe('US1 - Start Screen', () => {
  async function mockEmptyCatalog(page: import('@playwright/test').Page) {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [],
          completed: [],
          counts: {
            in_progress: 0,
            completed: 0,
          },
        },
      });
    });
  }

  test('shows the 3-option landing menu and keeps disabled options non-navigable', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');

    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('2. View in-progress games')).toBeVisible();
    await expect(page.getByText('3. View completed games')).toBeVisible();

    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press('3');
    await expect(page).toHaveURL(/\/$/);
  });

  test('navigates to list routes when in-progress and completed counts are non-zero', async ({ page }) => {
    await enableAuthBypass(page);

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [
            {
              game_id: 'g-in-progress',
              blueprint_id: 'bp-1',
              mystery_title: 'In Progress Mystery',
              mystery_available: true,
              can_open: true,
              mode: 'explore',
              time_remaining: 6,
              outcome: null,
              last_played_at: '2026-03-10T12:00:00.000Z',
              created_at: '2026-03-09T12:00:00.000Z',
            },
          ],
          completed: [
            {
              game_id: 'g-completed',
              blueprint_id: 'bp-2',
              mystery_title: 'Completed Mystery',
              mystery_available: true,
              can_open: true,
              mode: 'ended',
              time_remaining: 0,
              outcome: 'win',
              last_played_at: '2026-03-09T12:00:00.000Z',
              created_at: '2026-03-08T12:00:00.000Z',
            },
          ],
          counts: {
            in_progress: 1,
            completed: 1,
          },
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('2. View in-progress games (1)')).toBeVisible();
    await expect(page.getByText('3. View completed games (1)')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/sessions\/in-progress$/);

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('3. View completed games (1)')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page).toHaveURL(/\/sessions\/completed$/);
  });

  test('enters new-game blueprint flow on option 1 and starts game by blueprint number', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
            { id: 'bp-2', title: 'The Missing Dog', one_liner: 'Find the dog', target_age: 9 },
          ],
        },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: 'game-123',
          state: {
            locations: [],
            characters: [],
            time_remaining: 10,
            location: 'living room',
            mode: 'explore',
            current_talk_character: null,
          },
          narration_events: [
            {
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'Game started.', speaker: narratorSpeaker }],
            },
          ],
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');

    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await expect(page.getByText('The Missing Dog')).toBeVisible();

    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);
  });

  test('shows centered loading indicator while starting from blueprint selection', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
          ],
        },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        json: {
          game_id: 'game-123',
          state: {
            locations: [],
            characters: [],
            time_remaining: 10,
            location: 'living room',
            mode: 'explore',
            current_talk_character: null,
          },
          narration_events: [
            {
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'Game started.', speaker: narratorSpeaker }],
            },
          ],
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('The Stolen Cake')).toBeVisible();

    const navPromise = page.waitForURL(/.*\/session/);
    await page.keyboard.press('1');

    await expect(page.getByText('[ INITIALIZING HYPER-NEURAL NARRATIVE ENGINE ]')).toBeVisible();
    await expect(page.getByTestId('terminal-spinner')).toBeVisible();
    await expect(page.getByText('Booting mystery session...')).toBeVisible();
    await expect(page.getByText('The Stolen Cake')).toHaveCount(0);

    await navPromise;
  });

  test('renders blueprint cover image when an authenticated link is issued', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              title: 'The Stolen Cake',
              one_liner: 'Find the cake',
              target_age: 6,
              blueprint_image_id: 'mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png',
            },
          ],
        },
      });
    });

    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({
        json: {
          image_id: 'mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png',
          signed_url:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');

    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await expect(page.locator('[data-testid="story-image-panel"] img')).toBeVisible();
  });

  test('shows placeholder when blueprint image link request fails', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              title: 'The Stolen Cake',
              one_liner: 'Find the cake',
              target_age: 6,
              blueprint_image_id: 'mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png',
            },
          ],
        },
      });
    });

    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({ status: 404, json: { error: 'Not found' } });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');

    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await expect(page.getByText('Case image unavailable')).toBeVisible();
  });
});
