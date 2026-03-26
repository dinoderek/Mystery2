<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';

  const mysteryTitle = $derived.by(() => {
    const id = gameSessionStore.game_id;
    if (!id) return 'Unknown Mystery';
    const allRows = [
      ...gameSessionStore.sessionCatalog.in_progress,
      ...gameSessionStore.sessionCatalog.completed,
    ];
    const row = allRows.find((entry) => entry.game_id === id);
    return row?.mystery_title || 'Unknown Mystery';
  });
</script>

<header class="border-b border-t-muted/30 pb-2 mb-4">
  <h1 class="text-xl font-bold truncate">Mystery: {mysteryTitle}</h1>
</header>
