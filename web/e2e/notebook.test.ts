import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { confirmOpening, playedTurn, stubTurns } from './session-helpers';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameStartResponse,
  createNarrationEvent,
  createRevealedClue,
  createTurnQuitResponse,
  createTurnViewResponse,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
  await signInAsTestProfile(page);

  await page.route('**/api/game-sessions-list*', async (route) => {
    await route.fulfill({ json: EMPTY_CATALOG });
  });

  await page.route('**/api/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
    });
  });

  await page.route('**/api/game-start*', async (route) => {
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
    await stubTurns(page, () =>
      playedTurn('search', 'Crumbs on the floor.', {
        clues: [
          {
            ...createRevealedClue({ id: 'clue-crumbs', text: 'Crumbs lead to the pantry.' }),
            // A stale/legacy payload may still carry spoiler-bearing thread
            // labels. Nothing in the client may surface them.
            threads: [{ kind: 'red_herring', label: 'Red herring: the open window' }],
          } as ReturnType<typeof createRevealedClue>,
        ],
      }),
    );

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

  test('opens on Tab without asking the game, and on the notebook command by asking it', async ({ page }) => {
    const requests = await stubTurns(page, () => createTurnViewResponse({ view: 'notebook', section: null }));
    await bootstrapSession(page);

    const notebook = page.getByRole('dialog');
    await page.keyboard.press('Tab');
    await expect(notebook).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notebook).toBeHidden();
    expect(requests).toEqual([]);

    const input = page.locator('input[type="text"]');
    await input.fill('notebook');
    await input.press('Enter');
    await expect(notebook).toBeVisible();
    expect(requests.map((request) => request.input)).toEqual(['notebook']);
    // Opening it leaves no line behind in the transcript.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-speaker-kind="investigator"]')).toHaveCount(0);
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
    await stubTurns(page, () => createTurnQuitResponse());
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
