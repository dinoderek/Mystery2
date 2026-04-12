import { test, expect, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createSessionSummary,
  createSessionCatalog,
  createBlueprintSummary,
  createImageLinkResponse,
  createGameState,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

/**
 * Extended mobile E2E coverage for the home screen, blueprint carousel,
 * session list routes, and briefs gating (T07).
 *
 * Runs under the `mobile-safari` Playwright project (iPhone 13 / WebKit).
 * Basic home-screen and in-progress carousel tests live in mobile.spec.ts;
 * this file adds the remaining T07 acceptance criteria.
 */

// ---------------------------------------------------------------------------
// Helpers — mock API routes
// ---------------------------------------------------------------------------

async function mockEmptyCatalog(page: Page) {
  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: EMPTY_CATALOG,
    });
  });
}

async function mockCatalogWithSessions(page: Page) {
  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        in_progress: [
          createSessionSummary({
            game_id: '00000000-0000-0000-0000-000000000001',
            blueprint_id: '00000000-0000-0000-0000-000000000002',
            mystery_title: 'In Progress Mystery',
            mystery_available: true,
            can_open: true,
            mode: 'explore',
            time_remaining: 6,
            outcome: null,
            last_played_at: '2026-03-10T12:00:00.000Z',
            created_at: '2026-03-09T12:00:00.000Z',
          }),
        ],
        completed: [
          createSessionSummary({
            game_id: '00000000-0000-0000-0000-000000000010',
            blueprint_id: '00000000-0000-0000-0000-000000000003',
            mystery_title: 'Completed Mystery',
            mystery_available: true,
            can_open: true,
            mode: 'ended',
            time_remaining: 0,
            outcome: 'win',
            last_played_at: '2026-03-11T12:00:00.000Z',
            created_at: '2026-03-08T12:00:00.000Z',
          }),
        ],
        counts: { in_progress: 1, completed: 1 },
      }),
    });
  });
}

async function mockBlueprints(page: Page, count: number = 1) {
  const blueprints = [
    createBlueprintSummary({
      id: '00000000-0000-0000-0000-000000000002',
      title: 'The Stolen Cake',
      one_liner: 'Find the cake',
      target_age: 6,
      blueprint_image_id: 'mock-cover.png',
    }),
    createBlueprintSummary({
      id: '00000000-0000-0000-0000-000000000003',
      title: 'The Missing Dog',
      one_liner: 'Find the dog',
      target_age: 9,
      blueprint_image_id: null,
    }),
    createBlueprintSummary({
      id: '00000000-0000-0000-0000-000000000004',
      title: 'The Haunted Barn',
      one_liner: 'Explore the barn',
      target_age: 12,
      blueprint_image_id: null,
    }),
  ].slice(0, count);

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({ json: { blueprints } });
  });
}

async function mockBlueprintImageLink(page: Page) {
  await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
    await route.fulfill({
      json: createImageLinkResponse({
        image_id: 'mock-cover.png',
        signed_url:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        expires_at: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
}

async function mockGameStart(page: Page) {
  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: '00000000-0000-0000-0000-000000000020',
        state: createGameState({
          locations: [{ id: 'loc-1', name: 'Kitchen' }],
          characters: [],
          time_remaining: 10,
          location: 'Kitchen',
          mode: 'explore',
          current_talk_character: null,
        }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'start',
            narration_parts: [{ text: 'Your investigation begins.', speaker: narratorSpeaker }],
          }),
        ],
      },
    });
  });
}

async function mockResumeSession(page: Page) {
  await page.route('**/functions/v1/game-get*', async (route) => {
    await route.fulfill({
      json: {
        blueprint_id: '00000000-0000-0000-0000-000000000002',
        state: createGameState({
          locations: [{ id: 'loc-1', name: 'Kitchen' }],
          characters: [],
          time_remaining: 6,
          location: 'Kitchen',
          mode: 'explore',
          current_talk_character: null,
          history: [],
        }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'narration',
            narration_parts: [{ text: 'Welcome back.', speaker: narratorSpeaker }],
          }),
        ],
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Home screen — briefs gating & logout
// ---------------------------------------------------------------------------

test.describe('mobile home screen — extended', () => {
  test('no Manage Briefs button visible on mobile', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    await expect(page.getByTestId('mobile-home-new-game')).toBeVisible();

    // Desktop "Manage briefs" option must not appear on mobile
    await expect(page.getByText('Manage briefs', { exact: false })).not.toBeVisible();
    await expect(page.getByText('4.')).not.toBeVisible();
  });

  test('logout button is visible', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    const logoutBtn = page.getByTestId('mobile-home-logout');
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toContainText('LOGOUT');
  });
});

// ---------------------------------------------------------------------------
// Blueprint carousel — cover images, dots, tap-to-start
// ---------------------------------------------------------------------------

test.describe('mobile blueprint carousel', () => {
  test('blueprint card displays title and cover image', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await mockBlueprints(page, 1);
    await mockBlueprintImageLink(page);

    await page.goto('/');
    await page.getByTestId('mobile-home-new-game').tap();

    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await expect(page.getByText('Find the cake')).toBeVisible();
    await expect(page.getByAltText('Case art')).toBeVisible();
  });

  test('dot indicators render for multiple blueprints', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await mockBlueprints(page, 3);

    await page.goto('/');
    await page.getByTestId('mobile-home-new-game').tap();

    await expect(page.getByText('The Stolen Cake')).toBeVisible();

    // Dots only render when items.length > 1; we have 3 blueprints → 3 dots
    const dots = page.locator('button[aria-label^="Go to item"]');
    await expect(dots).toHaveCount(3);
  });

  test('tapping a blueprint card starts the game and navigates to /session', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await mockBlueprints(page, 1);
    await mockGameStart(page);

    await page.goto('/');
    await page.getByTestId('mobile-home-new-game').tap();
    await expect(page.getByText('The Stolen Cake')).toBeVisible();

    // Tap the card to start
    await page.getByText('The Stolen Cake').tap();
    await expect(page).toHaveURL(/\/session/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Session list routes — detailed card content & completed carousel
// ---------------------------------------------------------------------------

test.describe('mobile session lists', () => {
  test('in-progress cards show title, turns remaining, and last played', async ({ page }) => {
    await enableAuthBypass(page);
    await mockCatalogWithSessions(page);

    await page.goto('/sessions/in-progress');

    await expect(page.getByText('In Progress Mystery')).toBeVisible();
    await expect(page.getByText('Turns left: 6')).toBeVisible();
    // formatLastPlayed produces "2026-03-10 12:00 UTC"
    await expect(page.getByText('2026-03-10 12:00 UTC')).toBeVisible();
  });

  test('completed carousel renders with title and outcome', async ({ page }) => {
    await enableAuthBypass(page);
    await mockCatalogWithSessions(page);

    await page.goto('/sessions/completed');
    await expect(page.getByTestId('mobile-topbar-title')).toHaveText('Case History');

    await expect(page.getByText('Completed Mystery')).toBeVisible();
    // formatOutcome('win') → "Solved"
    await expect(page.getByText('Outcome: Solved')).toBeVisible();
    await expect(page.getByText('2026-03-11 12:00 UTC')).toBeVisible();
  });

  test('completed carousel back arrow navigates to /', async ({ page }) => {
    await enableAuthBypass(page);
    await mockCatalogWithSessions(page);

    await page.goto('/sessions/completed');
    await expect(page.getByTestId('mobile-topbar-back')).toBeVisible();

    await page.getByTestId('mobile-topbar-back').tap();
    await expect(page).toHaveURL(/\/$/);
  });

  test('tap in-progress card resumes session and navigates to /session', async ({ page }) => {
    await enableAuthBypass(page);
    await mockCatalogWithSessions(page);
    await mockResumeSession(page);

    await page.goto('/sessions/in-progress');
    await expect(page.getByText('In Progress Mystery')).toBeVisible();

    await page.getByText('In Progress Mystery').tap();
    await expect(page).toHaveURL(/\/session/, { timeout: 10000 });
  });

  test('in-progress empty state shows message', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/sessions/in-progress');
    await expect(page.getByText('No cases in progress')).toBeVisible();
  });

  test('completed empty state shows message', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/sessions/completed');
    await expect(page.getByText('No completed cases')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Briefs gating — mobile redirect
// ---------------------------------------------------------------------------

test.describe('mobile briefs gating', () => {
  test('/briefs redirects to / on mobile', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/briefs');
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    // Should land on mobile home
    await expect(page.getByTestId('mobile-home-new-game')).toBeVisible();
  });
});
