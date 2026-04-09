<script lang="ts">
  import { onMount } from 'svelte';

  let { onback }: { onback: () => void } = $props();

  let isMobile = $state(false);

  onMount(() => {
    isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  });
</script>

{#if isMobile}
  <button
    type="button"
    onclick={onback}
    aria-label="Back"
    data-testid="mobile-back"
    class="fixed top-2 left-2 z-40 w-10 h-10 flex items-center justify-center border border-t-muted/40 bg-t-bg/80 text-t-primary font-mono text-lg hover:border-t-primary active:bg-t-bg"
  >
    ←
  </button>
{/if}
