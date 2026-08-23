import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import { confirmOpening } from './session-helpers';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameStartResponse,
  createNarrationEvent,
  createSearchResponse,
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
  await confirmOpening(page);
}

test.describe('Case notebook', () => {
  test('groups discovered clues by origin and never prints reasoning-path labels', async ({
    page,
  }) => {
    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: [{ text: 'Crumbs on the floor.', speaker: narratorSpeaker }],
          revealed_clues: [
            {
              id: 'clue-crumbs',
              text: 'Crumbs lead to the pantry.',
              source: 'search',
              origin: {
                kind: 'location',
                location_id: 'loc-kitchen',
                location_name: 'Kitchen',
              },
              discovered_at: '2026-06-01T10:00:00Z',
              off_script: false,
              // A stale/legacy payload may still carry spoiler-bearing thread
              // labels. Nothing in the client may surface them.
              threads: [{ kind: 'red_herring', label: 'Red herring: the open window' }],
            },
          ],
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('Crumbs on the floor.')).toBeVisible();

    // The discovery toast echoes the clue text; tapping it opens the notebook
    // and dismisses the celebration, so the assertions below see one copy.
    await page.getByText('NEW CLUE DISCOVERED').click();

    await expect(page.getByText('CASE NOTEBOOK')).toBeVisible();
    // The toast is clue-specific, so it lands on the clues section.
    await expect(page.getByRole('tab', { name: 'CLUES' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Crumbs lead to the pantry.')).toBeVisible();
    // Grouped by where it was found — something the player already knows.
    await expect(page.getByText('FOUND AT PLACES')).toBeVisible();
    await expect(page.getByText('Kitchen (1)')).toBeVisible();
    // The mystery-spoiling grouping must not appear anywhere on the page.
    await expect(page.getByText(/Red herring/i)).toHaveCount(0);
    await expect(page.getByText(/Main solution/i)).toHaveCount(0);
    await expect(page.getByText(/Ruling out/i)).toHaveCount(0);
  });

  test('toggles with Tab and closes with Escape', async ({ page }) => {
    await bootstrapSession(page);

    const notebook = page.getByRole('dialog');
    await expect(notebook).toBeHidden();

    await page.keyboard.press('Tab');
    await expect(notebook).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(notebook).toBeHidden();

    await page.keyboard.press('Tab');
    await expect(notebook).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notebook).toBeHidden();
  });

  test('navigates sections with arrows and number keys', async ({ page }) => {
    await bootstrapSession(page);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'STORY' })).toHaveAttribute('aria-selected', 'true');

    // Wraps backwards off the front of the strip.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'CLUES' })).toHaveAttribute('aria-selected', 'true');

    // ...and forwards off the end.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'STORY' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('2');
    await expect(page.getByRole('tab', { name: 'PLACES' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('3');
    await expect(page.getByRole('tab', { name: 'PEOPLE' })).toHaveAttribute('aria-selected', 'true');
  });

  test('reopens at the section the player left', async ({ page }) => {
    await bootstrapSession(page);

    await page.keyboard.press('Tab');
    await page.keyboard.press('4');
    await expect(page.getByRole('tab', { name: 'CLUES' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: 'CLUES' })).toHaveAttribute('aria-selected', 'true');
  });

  test('parks the command input while open and hands focus back on close', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await page.keyboard.press('Tab');
    await expect(input).not.toBeFocused();

    // Section shortcuts must not leak into the command line.
    await page.keyboard.press('2');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
  });

  test('stays reachable after the case ends, while any other key still exits', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('quit');
    await input.press('Enter');
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

    // The one carve-out from "press any key": Tab reviews the finished case.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/.*\/session/);

    // While the notebook is open no key leaves the session.
    await page.keyboard.press('k');
    await expect(page).toHaveURL(/.*\/session/);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.keyboard.press('k');
    await expect(page).toHaveURL(/\/$/);
  });
});
