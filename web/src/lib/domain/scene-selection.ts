import { BlueprintScenesResponseSchema, type SceneManifest } from '@my2/shared';
import type { SessionPage } from './session-pages';
import { callApiGet } from '../api/client';
import { readAnswer } from './contract';

export function sceneForPage(
  manifest: SceneManifest | null,
  page: SessionPage | null,
) {
  if (page?.kind === 'opening') return manifest?.scenes[0] ?? null;
  if (
    page?.kind !== 'location' &&
    !(page?.kind === 'conversation' && !page.imageId)
  )
    return null;
  return (
    manifest?.scenes.find((scene) => scene.location_id === page.locationId) ??
    null
  );
}

export async function loadSceneManifest(
  blueprintId: string,
): Promise<SceneManifest | null> {
  const response = await callApiGet('blueprint-scenes', {
    blueprint_id: blueprintId,
  });
  const parsed = readAnswer(
    response,
    BlueprintScenesResponseSchema,
    'blueprint-scenes',
  );
  if (!parsed.ok) {
    if (response.error)
      console.error('[scene] Scene artwork unavailable', {
        blueprint_id: blueprintId,
        error: parsed.message,
      });
    return null;
  }
  if (parsed.value.blueprint_id !== blueprintId) {
    console.error('[scene] Scene artwork belongs to another case', {
      blueprint_id: blueprintId,
    });
    return null;
  }
  return parsed.value;
}
