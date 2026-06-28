<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";
  import type { DiscoveredClue } from "$lib/types/game";

  function close() {
    gameSessionStore.showNotebook = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  const OTHER_GROUP = "Other clues";

  // Group discovered clues by mini-mystery thread. A clue serving several threads
  // appears under each; a clue with none falls into "Other clues".
  const groups = $derived.by(() => {
    const clues = gameSessionStore.state?.discovered_clues ?? [];
    const byLabel = new Map<string, DiscoveredClue[]>();
    for (const clue of clues) {
      const labels = clue.threads.length > 0 ? clue.threads.map((t) => t.label) : [OTHER_GROUP];
      for (const label of labels) {
        const list = byLabel.get(label) ?? [];
        list.push(clue);
        byLabel.set(label, list);
      }
    }
    return [...byLabel.entries()].map(([label, items]) => ({ label, items }));
  });

  const total = $derived(gameSessionStore.state?.discovered_clues.length ?? 0);

  function originLabel(clue: DiscoveredClue): string {
    return clue.origin.kind === "character"
      ? `from ${clue.origin.character_name}`
      : `at ${clue.origin.location_name}`;
  }
</script>

{#if gameSessionStore.showNotebook}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-t-bg/80 flex items-center justify-center p-4 z-50"
    onclick={handleBackdropClick}
  >
    <div
      class="bg-t-bg border border-t-muted shadow-[0_0_15px_var(--t-glow)] p-6 max-w-lg w-full font-mono max-h-[80vh] overflow-y-auto"
    >
      <h2 class="text-xl font-bold text-t-primary border-b border-t-muted/30 pb-2 mb-4">
        DETECTIVE'S NOTEBOOK <span class="text-t-muted/60 text-sm">({total} clue{total === 1 ? "" : "s"})</span>
      </h2>

      {#if total === 0}
        <p class="text-t-muted/70 text-sm">
          No clues yet. Search locations and question characters to fill your notebook.
        </p>
      {:else}
        <div class="space-y-4 text-sm">
          {#each groups as group (group.label)}
            <section>
              <h3 class="text-t-primary font-bold mb-1">{group.label}</h3>
              <ul class="space-y-2">
                {#each group.items as clue (clue.id)}
                  <li class="border-l-2 border-t-muted/40 pl-3">
                    <span class="text-t-bright">{clue.text}</span>
                    <span class="block text-t-muted/60 text-xs mt-0.5">
                      {originLabel(clue)}{#if clue.off_script} · a lucky break{/if}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}

      <button
        class="mt-6 w-full border border-t-muted/50 hover:bg-t-muted/10 text-t-primary py-2 transition-colors cursor-pointer"
        onclick={close}
      >
        [ CLOSE ]
      </button>
    </div>
  </div>
{/if}
