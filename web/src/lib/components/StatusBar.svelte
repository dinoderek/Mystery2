<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

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
  class="flex justify-between items-center border border-t-muted/30 p-2 bg-t-muted/5 mt-4 text-sm"
>
  <span>LOCATION: {currentLocationName}</span>
  <span class="text-t-muted/50">type 'help' to see commands</span>
  <span>TIME: {gameSessionStore.state?.time_remaining || 0}</span>
</div>
<div
  class="border border-t-muted/30 p-2 bg-t-muted/5 mt-2 text-sm flex gap-2"
>
  <span class="text-t-muted/70">VISIBLE:</span>
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
