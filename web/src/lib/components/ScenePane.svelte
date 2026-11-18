<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import BlueprintImage from './BlueprintImage.svelte';
  import SceneView from './SceneView.svelte';
  import { sceneForPage, loadSceneManifest } from '$lib/domain/scene-selection';
  import type { SceneManifest } from '@my2/shared';

  const page = $derived(gameSessionStore.activePage);
  const blueprintId = $derived(gameSessionStore.blueprint_id);
  let manifest = $state<SceneManifest | null>(null);
  const recipe = $derived(sceneForPage(manifest, page));

  $effect(() => {
    const id = blueprintId;
    manifest = null;
    if (!id) return;
    let cancelled = false;
    void loadSceneManifest(id).then((loaded) => { if (!cancelled) manifest = loaded; });
    return () => { cancelled = true; };
  });
</script>

<div class="story-image-panel h-full w-full overflow-hidden" data-testid="scene-pane">
  {#if recipe}
    {#key `${blueprintId}/${recipe.location_id}`}
      <SceneView {recipe}>{@render illustration()}</SceneView>
    {/key}
  {:else}
    {@render illustration()}
  {/if}
</div>

{#snippet illustration()}
  {#if page?.imageId && blueprintId}
    {#key page.imageId}
      <BlueprintImage
        blueprintId={blueprintId}
        imageId={page.imageId}
        alt={page.title ?? page.fallbackLabel}
        class="h-full w-full object-cover"
      />
    {/key}
  {:else}
    <!-- An unlabelled blank reads as a broken page rather than a case with no art. -->
    <div
      class="story-image-placeholder flex h-full w-full items-center justify-center text-sm text-t-muted/80"
    >
      {page?.title ?? page?.fallbackLabel ?? 'No scene image'}
    </div>
  {/if}
{/snippet}
