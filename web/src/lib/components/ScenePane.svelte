<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import SignedImage from './SignedImage.svelte';

  const page = $derived(gameSessionStore.activePage);
  const blueprintId = $derived(gameSessionStore.blueprint_id);
</script>

<div class="story-image-panel h-full w-full overflow-hidden" data-testid="scene-pane">
  {#if page?.imageId && blueprintId}
    {#key page.imageId}
      <SignedImage
        blueprintId={blueprintId}
        imageId={page.imageId}
        alt={page.title ?? page.fallbackLabel}
        class="h-full w-full object-cover"
      />
    {/key}
  {:else}
    <!-- The pane is two thirds of the screen, so an unlabelled blank reads as a
         broken page rather than a case with no art for this scene. -->
    <div
      class="story-image-placeholder flex h-full w-full items-center justify-center text-sm text-t-muted/80"
    >
      {page?.title ?? page?.fallbackLabel ?? 'No scene image'}
    </div>
  {/if}
</div>
