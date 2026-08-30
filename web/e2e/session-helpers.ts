import { expect, type Page } from '@playwright/test';
import { NARRATOR_SPEAKER } from '../../tests/testkit/src/fixtures';

/**
 * A started case opens on the premise and waits for the player before stepping
 * into the first location, so a spec that wants to issue commands has to get
 * past that prompt first.
 *
 * The arrival narration defaults to the line most specs already assert on, so
 * the text they look for is on the page they land on.
 */
export async function confirmOpening(
  page: Page,
  narration = 'You enter the kitchen.',
) {
  // Narration only. The real endpoint echoes location/mode/time back unchanged,
  // so anything this mock sent would just overwrite whatever session state the
  // calling spec set up in its game-start fixture.
  await page.route('**/api/game-enter*', async (route) => {
    await route.fulfill({
      json: {
        narration_parts: [
          { text: narration, speaker: NARRATOR_SPEAKER, image_id: null },
        ],
      },
    });
  });

  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();
  await expect(page.locator('input[type="text"]')).toBeVisible();
}
