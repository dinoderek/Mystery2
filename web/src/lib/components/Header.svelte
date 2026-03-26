<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';

  const mysteryTitle = $derived.by(() => {
    const blueprintId = gameSessionStore.blueprint_id;
    if (!blueprintId) return 'Unknown Mystery';
    const blueprint = gameSessionStore.blueprints.find((b) => b.id === blueprintId);
    return blueprint?.title || 'Unknown Mystery';
  });
</script>

<header class="border-b border-t-muted/30 pb-2 mb-4">
  <h1 class="text-xl font-bold truncate">Mystery: {mysteryTitle}</h1>
</header>
