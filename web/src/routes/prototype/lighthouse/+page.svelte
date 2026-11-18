<script lang="ts">
  import LighthouseScene from '$lib/components/LighthouseScene.svelte';
</script>

<svelte:head><title>Lantern Room — Mystery2</title></svelte:head>

<main class="relative h-screen w-screen">
  <LighthouseScene>
    <div class="story-image-placeholder flex h-full items-center justify-center text-t-muted">
      The lantern room
    </div>
  </LighthouseScene>
  <a href="/" class="absolute bottom-4 left-4 bg-t-bg/80 px-3 py-2 text-sm text-t-primary hover:text-t-bright">
    [ BACK TO MYSTERIES ]
  </a>
</main>
