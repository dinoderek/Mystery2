<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";
  import { accusationsLeftText } from "$lib/domain/accusations";

  const currentLocationName = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) return "UNKNOWN";
    const loc = state.locations.find((l) => l.id === state.location);
    return loc?.name || state.location;
  });

  const visibleCharacters = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) {
      return [];
    }

    const currentLocation = state.location.trim().toLowerCase();
    return state.characters.filter(
      (character) => character.location_name.trim().toLowerCase() === currentLocation,
    );
  });
</script>

<div
  class="flex flex-wrap justify-between items-center gap-x-4 border border-t-muted/30 p-2 bg-t-muted/5 mt-4 text-sm group-data-[compact=true]:mt-2"
>
  <span><span class="text-t-muted/70 font-bold">LOCATION:</span> {currentLocationName}</span>
  <div class="flex flex-wrap items-center gap-x-4">
    <button
      class="min-h-11 min-w-11 text-t-primary hover:text-t-bright transition-colors cursor-pointer"
      onclick={() => gameSessionStore.openNotebook()}
    >
      <span class="text-t-muted/70 font-bold">CLUES:</span>
      {gameSessionStore.state?.discovered_clues.length ?? 0}
    </button>
    <span><span class="text-t-muted/70 font-bold">TIME:</span> {gameSessionStore.state?.time_remaining || 0}</span>
    <span title={accusationsLeftText(gameSessionStore.state?.accusations_left ?? 0)}
      ><span class="text-t-muted/70 font-bold">ACCUSATIONS:</span>
      {gameSessionStore.state?.accusations_left ?? 0}</span
    >
  </div>
</div>
<div class="flex items-center border border-t-muted/30 p-2 bg-t-muted/5 mt-2 text-sm group-data-[compact=true]:hidden">
  <div class="flex gap-2">
    <span class="text-t-muted/70 font-bold">CHARACTERS:</span>
    <div>
      {#if visibleCharacters.length > 0}
        {#each visibleCharacters as char, i}
          <span
            >{char.first_name} {char.last_name}{i < visibleCharacters.length - 1 ? ", " : ""}</span
          >
        {/each}
      {:else}
        <span class="text-t-muted/50">None</span>
      {/if}
    </div>
  </div>
</div>
