import { expect, test } from '@playwright/test';
import { listOnlyMockCase } from '../session-helpers';

// Runs on the phone and tablet projects: the mock case played to a win against
// the real server and its mock narrator, from signing in to reviewing the
// finished game, by touch and text entry only. Nothing presses a key. `fill`
// sends input events only, a line is submitted by [ SEND ] or by the form's own
// submit event, and a page-level listener proves that no keydown reached the
// page.
//
// The win is the shortest the case allows: the empty jar, Bob cleared by his
// score sheet, and Alice accused citing the jar (`blueprints/clue-graph/mock-case.json`).

test('a player plays a whole case to its end by touch and text entry only', async ({ page }) => {
  await page.addInitScript(() => {
    const keys: string[] = [];
    (window as unknown as { __keys: string[] }).__keys = keys;
    window.addEventListener('keydown', (event) => keys.push(event.key), true);
  });
  await listOnlyMockCase(page);
  const lines: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/game-turn')) lines.push((request.postDataJSON() as { input: string }).input);
  });

  // Sign in through the picker, and start the case.
  await page.goto('/login');
  await page.locator('#profile-name').fill(`touch-play-${crypto.randomUUID().slice(0, 8)}`);
  await page.locator('[data-testid="reading-age-option"][data-age="8"]').tap();
  await page.getByRole('button', { name: '[ START ]' }).tap();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('menu-row-1').tap();
  await page.getByTestId('case-card-1').tap();
  await expect(page).toHaveURL(/\/session$/);

  // Begin by tapping the prompt.
  await page.getByTestId('begin-investigation-prompt').tap();
  await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();
  // What the narrator says, not a clue toast or the notebook repeating it.
  const narration = page.getByTestId('page-narration');
  await expect(narration.getByText(/You arrive at Kitchen/)).toBeVisible();

  const input = page.locator('input[type="text"]');
  const form = page.locator('form');
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
  await input.fill('search the pantry shelf');
  await page.getByTestId('send-button').tap();
  await expect(narration.getByText(/The cookie jar on the pantry shelf is empty/)).toBeVisible();
  await expect(input).toBeFocused();

  // And by the form's submit event, as the keyboard's action key does: no Enter keydown.
  await input.fill('go to the living room');
  await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
  await expect(narration.getByText(/You arrive at Living Room/)).toBeVisible();
  await input.fill('search');
  await page.getByTestId('send-button').tap();
  await expect(narration.getByText(/score sheet shows a move written in Bob's handwriting/)).toBeVisible();

  // Page back through the transcript, and return to the live page.
  const label = page.getByTestId('page-label');
  await expect(label).toHaveText('Living Room');
  await page.getByTestId('page-prev').tap();
  await expect(label).toHaveText('Kitchen');
  await page.getByTestId('page-latest').tap();
  await expect(label).toHaveText('Living Room');

  // The notebook, from the status bar, with no key hints and a tappable close.
  await page.getByRole('button', { name: /CLUES:/ }).tap();
  const notebook = page.getByRole('dialog', { name: 'CASE NOTEBOOK' });
  await expect(notebook).toBeVisible();
  await expect(notebook.getByText('Tab close')).toBeHidden();
  await notebook.getByRole('tab', { name: /People/i }).tap();
  await expect(notebook.getByRole('tab', { name: /People/i })).toHaveAttribute('aria-selected', 'true');
  await notebook.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(notebook).toBeHidden();

  // Help, typed, with no key hints and a tappable close.
  await input.fill('help');
  await page.getByTestId('send-button').tap();
  const help = page.getByText('COMMAND REFERENCE');
  await expect(help).toBeVisible();
  await expect(page.getByText('PageUp / PageDown')).toBeHidden();
  await page.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(help).toBeHidden();

  // Accuse, citing the jar.
  await input.fill('accuse');
  await page.getByTestId('send-button').tap();
  await expect(narration.getByText(/Who did it, and how do you know\?/)).toBeVisible();
  await input.fill('Alice did it: the cookie jar is empty and has floury fingerprints.');
  await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
  await expect(narration.getByText(/You solved it! Alice did it\./)).toBeVisible();
  await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

  // Review the notebook from the end state, then go back to the mystery list.
  await page.getByTestId('review-notebook-button').tap();
  await expect(notebook).toBeVisible();
  await notebook.getByRole('button', { name: '[ CLOSE ]' }).tap();
  await expect(notebook).toBeHidden();
  await page.getByTestId('return-to-list-button').tap();
  await expect(page).toHaveURL(/\/$/);

  // The game is finished: it is in the completed list, and reopens read-only.
  await page.getByTestId('menu-row-3').tap();
  await expect(page).toHaveURL(/\/sessions\/completed$/);
  await expect(page.getByText(/Outcome: Solved/)).toBeVisible();
  await page.getByTestId('session-row-1').tap();
  await expect(page).toHaveURL(/\/session$/);
  await expect(narration.getByText(/You solved it! Alice did it\./)).toBeVisible();
  await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();
  await page.getByTestId('return-to-list-button').tap();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('menu-row-1')).toBeVisible();

  // Each line went to the engine as typed.
  expect(lines).toEqual([
    'search the pantry shelf',
    'go to the living room',
    'search',
    'help',
    'accuse',
    'Alice did it: the cookie jar is empty and has floury fingerprints.',
  ]);
  expect(await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys)).toEqual([]);
});
