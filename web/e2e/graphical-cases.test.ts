import { test, expect, type Page } from '@playwright/test';
import { BlueprintsListResponseSchema } from '@my2/shared';
import { signInAsTestProfile } from './test-profile';

const LIGHTHOUSE = '7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47';
const HEARTWOOD = 'a3f5c9d1-4e7b-4a2c-9f81-6b0d2e5a7c34';

// Keep the full game usable on the software WebGL2 fallback used by CI.
test.use({ launchOptions: { args: ['--disable-webgpu', '--use-angle=swiftshader'] } });

async function startCase(page: Page, blueprintId: string) {
  await signInAsTestProfile(page, 'graphical-case');
  const response = await page.request.get('/api/blueprints-list');
  const { blueprints } = BlueprintsListResponseSchema.parse(
    await response.json(),
  );
  const index = blueprints.findIndex(
    (blueprint) => blueprint.id === blueprintId,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText(blueprints[index].title)).toBeVisible();
  await page.keyboard.press(String(index + 1));
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('input[type="text"]')).toBeEnabled();
}

async function submit(page: Page, line: string) {
  const input = page.locator('input[type="text"]');
  await input.fill(line);
  await input.press('Enter');
  await expect(input).toBeEnabled();
}

async function expectScene(page: Page, location: string, kind = 'procedural') {
  const scene = page.getByTestId('scene-renderer');
  await expect(scene).toHaveAttribute('data-location-id', location);
  await expect(scene).toHaveAttribute('data-kind', kind);
  await expect(scene).toHaveAttribute('data-state', 'ready', {
    timeout: 30000,
  });
  await expect(scene.getByRole('img')).toBeInViewport();
  await expect(page.getByTestId('page-narration')).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeInViewport();
}

test('plays all lighthouse locations with real narration, dialogue, history, and resume', async ({
  page,
}) => {
  test.setTimeout(60000);
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await startCase(page, LIGHTHOUSE);
  await expectScene(page, 'lantern_room', 'lighthouse');
  expect(await page.locator('canvas').evaluate((canvas) => canvas.getContext('webgl2') !== null)).toBe(true);
  await expect(page.getByTestId('page-narration')).toContainText(
    'You arrive at Lantern Room',
  );
  await submit(page, 'talk to Ada');
  await expectScene(page, 'lantern_room', 'lighthouse');
  await submit(page, 'What can you tell me?');
  const reply = page.locator('[data-speaker-kind="character"]').last();
  await expect(reply).toContainText('Ada');
  await expect(reply).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeFocused();
  await submit(page, 'bye');
  await expectScene(page, 'lantern_room', 'lighthouse');
  await submit(page, "go Keeper's Cottage");
  await expectScene(page, 'keepers_cottage');
  await submit(page, 'go Village Quay');
  await expectScene(page, 'village_quay');

  await page.reload();
  await expect(page.getByText('2. View in-progress games')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('The Missing Lighthouse Lens')).toBeVisible();
  await page.keyboard.press('1');
  await expectScene(page, 'village_quay');
  const input = page.locator('input[type="text"]');
  await input.fill('search the cradle');
  await page.keyboard.press('PageUp');
  await expectScene(page, 'keepers_cottage');
  await expect(input).toHaveValue('search the cradle');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectScene(page, 'keepers_cottage');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('dialog', { name: /case notebook/i }),
  ).toBeVisible();
  expect(uncaught).toEqual([]);
});

test('uses the same renderer for all four forest locations through normal commands', async ({
  page,
}) => {
  test.setTimeout(60000);
  await startCase(page, HEARTWOOD);
  await expectScene(page, 'glimmerbank_landing');
  for (const [command, location] of [
    ['go Heartwood Hollow', 'heartwood_hollow'],
    ["go Eva's Leaf-Lab", 'eva_leaf_lab'],
    ['go Cheer Stage Grove', 'cheer_stage_grove'],
  ]) {
    await submit(page, command);
    await expectScene(page, location);
  }
});

test('keeps actual narration, dialogue, and typing usable when graphics cannot initialize', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      return type === 'webgl2'
        ? null
        : getContext.apply(this, [type, ...args] as Parameters<
            typeof getContext
          >);
    } as typeof getContext;
  });
  const errors: string[] = [];
  const uncaught: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[scene]')) errors.push(message.text());
  });
  page.on('pageerror', (error) => uncaught.push(error.message));
  await startCase(page, LIGHTHOUSE);
  await expect(page.getByTestId('scene-renderer')).toHaveAttribute(
    'data-state',
    'fallback',
  );
  await expect(page.getByTestId('page-narration')).toContainText(
    'You arrive at Lantern Room',
  );
  await submit(page, 'talk to Ada');
  await submit(page, 'What can you tell me?');
  await expect(
    page.locator('[data-speaker-kind="character"]').last(),
  ).toBeInViewport();
  await expect(page.locator('input[type="text"]')).toBeFocused();
  expect(errors).toHaveLength(1);
  expect(uncaught).toEqual([]);
});
