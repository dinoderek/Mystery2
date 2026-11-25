import { expect, test } from '@playwright/test';
import { signInAsTestProfile } from '../test-profile';
import { listOnlyMockCase, playedTurn, stubTurns } from '../session-helpers';
import { createTurnViewResponse } from '../../../tests/testkit/src/fixtures';

// Runs on the phone and tablet projects: a whole case by touch and text entry.
// Nothing presses a key. `fill` sends input events only, a line is submitted by
// [ SEND ] or by the form's own submit event, and a page-level listener proves
// that no keydown reached the page.

test('a player plays a case to its end by touch and text entry only', async ({ page }) => {
  await page.addInitScript(() => {
    const keys: string[] = [];
    (window as unknown as { __keys: string[] }).__keys = keys;
    window.addEventListener('keydown', (event) => keys.push(event.key), true);
  });

  await listOnlyMockCase(page);
  const turns = await stubTurns(page, ({ input }) => {
    if (input === 'help') return createTurnViewResponse({ view: 'help' });
    if (input === 'go to garden') {
      return playedTurn('move', 'You walk into the garden.', {
        payload: { location_name: 'Garden' },
        state: { location: 'loc-garden' },
      });
    }
    if (input === 'accuse') {
      return playedTurn('accuse_start', 'Who did it?', { state: { mode: 'accuse' } });
    }
    return playedTurn('accuse_resolved', 'Case closed. Excellent reasoning.', {
      state: { mode: 'ended', time_remaining: 0 },
      result: 'win',
    });
  });

  await signInAsTestProfile(page, 'touch-play');
  await page.goto('/');
  await page.getByTestId('menu-row-1').tap();
  await page.getByTestId('case-card-1').tap();
  await expect(page).toHaveURL(/\/session$/);

  // Begin by tapping the prompt.
  await page.getByTestId('begin-investigation-prompt').tap();
  await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();

  const input = page.locator('input[type="text"]');
  await expect(input).toBeVisible();

  // The input is made for the on-screen keyboard, and is not focused for it.
  await expect(input).toHaveAttribute('enterkeyhint', 'send');
  await expect(input).toHaveAttribute('autocapitalize', 'off');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  const fontSize = await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  await expect(input).not.toBeFocused();

  // Send a line with [ SEND ]; the input takes focus back once the turn is done.
  await input.tap();
  await expect(input).toBeFocused();
  await input.fill('go to garden');
  await page.getByTestId('send-button').tap();
  await expect(page.getByText('You walk into the garden.')).toBeVisible();
  await expect(input).toBeFocused();

  // Page back through the transcript, and return to the live page.
  await expect(page.getByTestId('page-navigator')).toContainText('Page 3 / 3');
  await page.getByTestId('page-prev').tap();
  await expect(page.getByTestId('page-navigator')).toContainText('Page 2 / 3');
  await page.getByTestId('page-latest').tap();
  await expect(page.getByTestId('page-navigator')).toContainText('Page 3 / 3');

  // The notebook, from the status bar, with no key hints and a tappable close.
  await page.getByRole('button', { name: /CLUES:/ }).tap();
  const notebook = page.getByRole('dialog', { name: 'CASE NOTEBOOK' });
  await expect(notebook).toBeVisible();
  await expect(notebook.getByText('Tab close')).toBeHidden();
  await notebook.getByRole('tab', { name: /People/i }).tap();
  await expect(notebook.getByRole('tab', { name: /People/i })).toHaveAttribute('aria-selected', 'true');
  await notebook.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(notebook).toBeHidden();

  // Help, typed and submitted by the form's submit event: no Enter keydown.
  await input.fill('help');
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const help = page.getByText('COMMAND REFERENCE');
  await expect(help).toBeVisible();
  await expect(page.getByText('PageUp / PageDown')).toBeHidden();
  await page.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(help).toBeHidden();

  // Accuse.
  await input.fill('accuse');
  await page.getByTestId('send-button').tap();
  await expect(page.getByText('Who did it?')).toBeVisible();
  await input.fill('Rosie did it because of the timeline.');
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

  // Review the notebook from the end state, then go back to the mystery list.
  await page.getByTestId('review-notebook-button').tap();
  await expect(notebook).toBeVisible();
  await notebook.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(notebook).toBeHidden();
  await page.getByTestId('return-to-list-button').tap();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('menu-row-1')).toBeVisible();

  expect(turns.map((turn) => turn.input)).toEqual([
    'go to garden',
    'help',
    'accuse',
    'Rosie did it because of the timeline.',
  ]);
  expect(await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).toEqual([]);
});
