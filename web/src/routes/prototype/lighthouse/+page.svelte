<script lang="ts">
  import SceneView from '$lib/components/SceneView.svelte';
  import type { SceneRecipe } from '@my2/shared';
  const recipe: SceneRecipe = { kind: 'lighthouse', location_id: 'lantern_room', label: 'The lighthouse lantern room: an empty brass cradle, tall windows, and a grey-green sea.' };
</script>

<svelte:head><title>Lantern Room — Mystery2</title></svelte:head>

<main class="relative h-screen w-screen">
  <SceneView {recipe}>
    <div class="story-image-placeholder flex h-full items-center justify-center text-t-muted">
      The lantern room
    </div>
  </SceneView>
  <a href="/" class="absolute bottom-4 left-4 bg-t-bg/80 px-3 py-2 text-sm text-t-primary hover:text-t-bright">
    [ BACK TO MYSTERIES ]
  </a>
</main>
