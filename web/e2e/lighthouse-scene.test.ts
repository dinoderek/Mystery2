import { test, expect } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';

test('renders the accepted preview with reduced motion and releases it when leaving', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await signInAsTestProfile(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/prototype/lighthouse');
  const scene = page.getByTestId('scene-renderer');
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
