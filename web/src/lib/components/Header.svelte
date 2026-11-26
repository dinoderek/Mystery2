<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';

  const mysteryTitle = $derived.by(() => {
    const blueprintId = gameSessionStore.blueprint_id;
    if (!blueprintId) return 'Unknown Mystery';
    const blueprint = gameSessionStore.blueprints.find((b) => b.id === blueprintId);
    return blueprint?.title || 'Unknown Mystery';
  });
</script>

<header class="shrink-0 px-3 py-1 group-data-[compact=true]:hidden">
  <h1 class="truncate text-xs font-bold text-t-muted/80" data-testid="session-title">{mysteryTitle}</h1>
</header>
