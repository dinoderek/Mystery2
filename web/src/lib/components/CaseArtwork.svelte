<script lang="ts">
  import { onMount } from 'svelte';
  import type { SceneRecipe } from '@my2/shared';
  import { loadSceneManifest } from '$lib/domain/scene-selection';
  import BlueprintImage from './BlueprintImage.svelte';
  import SceneView from './SceneView.svelte';

  let { blueprintId, imageId, alt }: { blueprintId: string; imageId?: string | null; alt: string } = $props();
  let recipe = $state<SceneRecipe | null>(null);
  let host: HTMLDivElement;
  let visible = $state(false);

  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(host);
    return () => observer.disconnect();
  });

  $effect(() => {
    const id = blueprintId;
    recipe = null;
    let cancelled = false;
    void loadSceneManifest(id).then((manifest) => {
      if (!cancelled) recipe = manifest?.scenes[0] ?? null;
    });
    return () => { cancelled = true; };
  });
</script>

<div bind:this={host} class="aspect-[4/3] w-full overflow-hidden" data-testid="case-artwork" data-blueprint-id={blueprintId}>
  {#if recipe && visible}
    {#key `${blueprintId}/${recipe.location_id}`}
      <SceneView {recipe} animated={false}>{@render illustration()}</SceneView>
    {/key}
  {:else}
    {@render illustration()}
  {/if}
</div>

{#snippet illustration()}
  {#if imageId}
    <BlueprintImage {blueprintId} {imageId} {alt} class="h-full w-full object-cover" placeholderText="Case image unavailable" />
  {:else}
    <div class="story-image-placeholder flex h-full items-center justify-center text-sm text-t-muted/80">Case image unavailable</div>
  {/if}
{/snippet}
