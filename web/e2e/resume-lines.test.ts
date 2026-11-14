import { expect, test } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';

// Against the real server and its mock narrator: a line the game refuses, and
// `help`, cost no turn but are saved, so a case opened again reads as it did.

test.describe('Lines that cost no turn', () => {
  test('are in the transcript again after the page is reloaded and the case reopened', async ({ page }) => {
    await signInAsTestProfile(page);
    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('Mock Blueprint')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();

    const input = page.locator('input[type="text"]');
    const transcript = page.getByTestId('page-narration');
    const turnsLeft = page.getByText(/TIME:/);
    const timeBefore = await turnsLeft.innerText();

    await input.fill('dance a little');
    await input.press('Enter');
    await expect(transcript.getByText(/Commands: move to\/go to <location>/)).toBeVisible();

    await input.fill('help');
    await input.press('Enter');
    await expect(page.getByRole('heading', { name: 'COMMAND REFERENCE' })).toBeVisible();
    await page.locator('button:has-text("[ CLOSE ]")').click();
    await expect(transcript.getByText('Help menu opened.')).toBeVisible();

    await expect(turnsLeft).toHaveText(timeBefore);
    const seen = await transcript.innerText();
    expect(seen).toContain('dance a little');

    // Reloading drops the case from the page; it comes back from the saved game.
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('2. View in-progress games')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/sessions\/in-progress/);
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    await expect(transcript.getByText('Help menu opened.')).toBeVisible();
    expect(await transcript.innerText()).toBe(seen);
    await expect(turnsLeft).toHaveText(timeBefore);
  });
});
