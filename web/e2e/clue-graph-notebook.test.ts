import { expect, test } from '@playwright/test';
import { clueGraphCaseId } from '@my2/shared';
import { signInAsTestProfile } from './test-profile';

// The greenhouse clue-graph case on the real server and the mock narrator: the
// notebook lists a lead marked new, then shows a statement as taken back.
test('the notebook shows a new lead, then a statement taken back', async ({ page }) => {
  await signInAsTestProfile(page, 'clue-graph-notebook');
  const catalog = await (await page.request.get('/api/blueprints-list')).json();
  const index = catalog.blueprints.findIndex(
    (entry: { id: string }) => entry.id === clueGraphCaseId('greenhouse-prizewinner'),
  );
  expect(index).toBeGreaterThanOrEqual(0);

  await page.goto('/');
  await expect(page.getByText('1. Start a new game', { exact: true })).toBeVisible();
  await page.keyboard.press('1');
  await expect(
    page.getByText('The Smashed Prize Pumpkin — clue graph', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press(String(index + 1));
  await expect(page).toHaveURL(/\/session/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await page.keyboard.press('Enter');
  const input = page.locator('input[type="text"]');
  await expect(input).toBeVisible();

  async function play(line: string) {
    const sent = page.waitForResponse((response) => response.url().endsWith('/api/game-turn'));
    await input.fill(line);
    await input.press('Enter');
    expect((await sent).status()).toBe(200);
  }

  const leads = page.getByTestId('notebook-leads');
  async function openClues() {
    await page.keyboard.press('Tab');
    await page.getByRole('tab', { name: 'CLUES' }).click();
  }

  // Before anything is played, the people to meet are leads, each new.
  await openClues();
  await expect(leads.getByText('You have not talked to Mr. Thorne yet.')).toBeVisible();
  await expect(leads.getByText('[ NEW ]').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await play('search');
  await play('go to the garden');
  await play('talk to Mr. Thorne');
  await openClues();
  await expect(leads.getByText('Mr. Thorne may know more.')).toBeVisible();
  await expect(leads.locator('li', { hasText: 'Mr. Thorne may know more.' }).getByText('[ NEW ]')).toBeVisible();
  await expect(page.getByText('(taken back)')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Showing the boot prints makes him take back what he said; the lead is spent.
  await play('These are your boot prints: clue_boot_prints');
  await openClues();
  await expect(page.getByText('(taken back)')).toBeVisible();
  await expect(leads.getByText('Mr. Thorne may know more.')).toHaveCount(0);
  await expect(page.getByText('[ NEW ]')).toHaveCount(0);
  await expect(page.locator('#nb-panel')).not.toContainText(/clue_graph|"truth"/);
});
