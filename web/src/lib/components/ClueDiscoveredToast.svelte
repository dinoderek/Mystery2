<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

  const clues = $derived(gameSessionStore.recentlyDiscovered);

  function openNotebook() {
    gameSessionStore.showNotebook = true;
    gameSessionStore.dismissRecentlyDiscovered();
  }

  // Auto-dismiss the celebration after a short beat. Re-runs whenever a new batch
  // of clues arrives.
  $effect(() => {
    if (clues.length === 0) return;
    const timer = setTimeout(() => gameSessionStore.dismissRecentlyDiscovered(), 6000);
    return () => clearTimeout(timer);
  });
</script>

{#if clues.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed bottom-24 right-4 z-40 max-w-xs bg-t-bg border border-t-primary shadow-[0_0_15px_var(--t-glow)] p-3 font-mono text-sm cursor-pointer"
    onclick={openNotebook}
  >
    <div class="text-t-primary font-bold mb-1">
      ✦ NEW CLUE{clues.length > 1 ? "S" : ""} DISCOVERED
    </div>
    <ul class="space-y-1 text-t-bright">
      {#each clues as clue (clue.id)}
        <li>{clue.text}{#if clue.off_script} <span class="text-t-muted/60">(a lucky break!)</span>{/if}</li>
      {/each}
    </ul>
    <div class="text-t-muted/60 text-xs mt-2">tap to open your notebook</div>
  </div>
{/if}
