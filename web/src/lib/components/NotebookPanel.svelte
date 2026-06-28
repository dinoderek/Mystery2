<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import type { DiscoveredClue } from '$lib/types/game';

  function close() {
    gameSessionStore.showNotebook = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (gameSessionStore.showNotebook && e.key === 'Escape') {
      close();
    }
  }

  const state = $derived(gameSessionStore.state);
  const characters = $derived(state?.characters ?? []);
  const locations = $derived(state?.locations ?? []);
  const clues = $derived(state?.discovered_clues ?? []);

  const OTHER_GROUP = 'Other clues';

  // Group discovered clues by mini-mystery thread. A clue serving several threads
  // appears under each; a clue with none falls into "Other clues".
  const clueGroups = $derived.by(() => {
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
</script>

<svelte:window onkeydown={handleKeydown} />

{#if gameSessionStore.showNotebook && state}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-t-bg/80 flex items-center justify-center p-4 z-50"
    onclick={handleBackdropClick}
  >
    <div
      class="bg-t-bg border border-t-muted shadow-[0_0_15px_var(--t-glow)] p-6 max-w-2xl w-full max-h-[85vh] flex flex-col font-mono"
    >
      <h2 class="text-xl font-bold text-t-primary border-b border-t-muted/30 pb-2 mb-4">
        CASE NOTEBOOK
      </h2>

      <div class="space-y-5 text-t-muted/90 text-sm overflow-y-auto pr-1">
        <section>
          <h3 class="text-t-primary font-bold mb-1">THE CASE</h3>
          {#if state.premise}
            <p class="mb-1 text-t-muted/90">{state.premise}</p>
          {/if}
          {#if state.mystery_summary}
            <p class="text-t-bright">{state.mystery_summary}</p>
          {/if}
          {#if !state.premise && !state.mystery_summary}
            <p class="italic text-t-muted/60">No case briefing available.</p>
          {/if}
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">PEOPLE</h3>
          {#if characters.length > 0}
            <ul class="space-y-2">
              {#each characters as character (character.id)}
                <li>
                  <span class="text-t-bright">{character.first_name} {character.last_name}</span>
                  {#if character.summary}
                    <span class="text-t-muted/80"> — {character.summary}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="italic text-t-muted/60">No people recorded yet.</p>
          {/if}
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">PLACES</h3>
          {#if locations.length > 0}
            <ul class="space-y-2">
              {#each locations as location (location.id)}
                <li>
                  <span class="text-t-bright">{location.name}</span>
                  {#if location.summary}
                    <span class="text-t-muted/80"> — {location.summary}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="italic text-t-muted/60">No places recorded yet.</p>
          {/if}
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">CLUES</h3>
          {#if clues.length > 0}
            <div class="space-y-3">
              {#each clueGroups as group (group.label)}
                <div>
                  <h4 class="text-t-muted/70 font-bold text-xs uppercase mb-1">{group.label}</h4>
                  <ul class="list-disc list-inside pl-1 space-y-1">
                    {#each group.items as clue (clue.id)}
                      <li class="text-t-muted/90">
                        {clue.text}{#if clue.off_script}<span class="text-t-muted/60"> (a lucky break!)</span>{/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          {:else}
            <p class="italic text-t-muted/60">No clues discovered yet. Search locations and talk to people to find them.</p>
          {/if}
        </section>
      </div>

      <button
        class="mt-6 w-full border border-t-muted/50 hover:bg-t-muted/10 text-t-primary py-2 transition-colors cursor-pointer shrink-0"
        onclick={close}
      >
        [ CLOSE ]
      </button>
    </div>
  </div>
{/if}
