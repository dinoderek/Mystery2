import { test, expect, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import {
  EMPTY_CATALOG,
  NARRATOR_SPEAKER,
  createBlueprintSummary,
  createGameState,
  createGameStartResponse,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';
import { LIGHTHOUSE_BLUEPRINT_ID } from '../src/lib/domain/scene-selection';

async function startLighthouse(page: Page) {
  await signInAsTestProfile(page);
  await page.route('**/api/game-sessions-list*', (route) =>
    route.fulfill({ json: EMPTY_CATALOG }),
  );
  await page.route('**/api/blueprints-list*', (route) =>
    route.fulfill({
      json: {
        blueprints: [
          createBlueprintSummary({
            id: LIGHTHOUSE_BLUEPRINT_ID,
            title: 'The Missing Lighthouse Lens',
          }),
        ],
      },
    }),
  );
  await page.route('**/api/game-start*', (route) =>
    route.fulfill({
      json: createGameStartResponse({
        state: createGameState({
          location: 'keepers_cottage',
          characters: [],
          locations: [
            { id: 'lantern_room', name: 'Lantern Room' },
            { id: 'keepers_cottage', name: "Keeper's Cottage" },
          ],
        }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'start',
            narration_parts: [
              { text: 'The lens has vanished.', speaker: NARRATOR_SPEAKER },
            ],
          }),
          createNarrationEvent({
            sequence: 2,
            event_type: 'move',
            payload: {
              location_id: 'lantern_room',
              location_name: 'Lantern Room',
            },
            narration_parts: [
              {
                text: 'Tall windows look out over the sea.',
                speaker: NARRATOR_SPEAKER,
                image_id: 'lantern.png',
              },
            ],
          }),
          createNarrationEvent({
            sequence: 3,
            event_type: 'talk',
            payload: { location_id: 'lantern_room', character_name: 'Ada' },
            narration_parts: [
              {
                text: 'Ada greets you.',
                speaker: NARRATOR_SPEAKER,
                image_id: 'ada.png',
              },
            ],
          }),
          createNarrationEvent({
            sequence: 4,
            event_type: 'end_talk',
            payload: {
              location_id: 'lantern_room',
              location_name: 'Lantern Room',
            },
            narration_parts: [
              {
                text: 'Back at the cradle.',
                speaker: NARRATOR_SPEAKER,
                image_id: 'lantern.png',
              },
            ],
          }),
          createNarrationEvent({
            sequence: 5,
            event_type: 'move',
            payload: {
              location_id: 'keepers_cottage',
              location_name: "Keeper's Cottage",
            },
            narration_parts: [
              {
                text: 'The cottage is cosy.',
                speaker: NARRATOR_SPEAKER,
                image_id: 'cottage.png',
              },
            ],
          }),
        ],
      }),
    }),
  );
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText('The Missing Lighthouse Lens')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/\/session$/);
}

test('selects the scene from the viewed page and preserves typing, portraits, and image fallback', async ({
  page,
}) => {
  // A browser with neither graphics backend must still render the existing artwork.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return getContext.apply(this, [type, ...args] as Parameters<
        typeof getContext
      >);
    } as typeof getContext;
  });
  const errors: string[] = [];
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  page.on('console', (message) => {
    if (message.text().startsWith('[scene]')) errors.push(message.text());
  });
  await startLighthouse(page);
  await expect(page.getByTestId('lighthouse-scene')).toHaveCount(0);
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('lighthouse-scene')).toHaveAttribute(
    'data-state',
    'fallback',
  );
  await expect(page.getByTestId('scene-pane').locator('img')).toBeVisible();
  expect(errors).toHaveLength(1);

  const input = page.locator('input[type="text"]');
  await input.fill('search the cradle');
  await expect(input).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('lighthouse-scene')).toHaveCount(0);
  await expect(page.getByTestId('scene-pane').locator('img')).toHaveAttribute(
    'src',
    /ada\.png$/,
  );
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('lighthouse-scene')).toHaveAttribute(
    'data-state',
    'fallback',
  );
  await expect(input).toHaveValue('search the cradle');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('dialog', { name: 'Case notebook' }),
  ).toBeVisible();
  expect(uncaught).toEqual([]);
});

test('renders the preview with reduced motion and releases it when leaving', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await signInAsTestProfile(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/prototype/lighthouse');
  const scene = page.getByTestId('lighthouse-scene');
  await expect(scene).toHaveAttribute('data-state', 'ready', {
    timeout: 30000,
  });
  await expect(scene).toHaveAttribute('data-paused', 'true');
  await expect(scene.getByRole('img')).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(scene.getByRole('img')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(scene).toHaveAttribute('data-paused', 'false');
  await page.getByRole('link', { name: '[ BACK TO MYSTERIES ]' }).click();
  await expect(scene).toHaveCount(0);
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  expect(uncaught).toEqual([]);
});
