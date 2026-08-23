<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';

  const page = $derived(gameSessionStore.activePage);
  const count = $derived(gameSessionStore.pageCount);
  const number = $derived((page?.index ?? 0) + 1);
  const atStart = $derived(number <= 1);
  const atEnd = $derived(number >= count);
</script>

{#if count > 0}
  <div
    class="mt-2 flex items-center gap-2 border border-t-muted/30 bg-t-muted/5 p-2 text-sm"
    data-testid="page-navigator"
  >
    <button
      type="button"
      class="px-1 text-t-primary hover:text-t-bright disabled:opacity-30 disabled:hover:text-t-primary"
      onclick={() => gameSessionStore.prevPage()}
      disabled={atStart}
      aria-label="Previous page"
      data-testid="page-prev"
    >
      &lsaquo;
    </button>

    <span class="whitespace-nowrap text-t-muted/70">
      Page {number} / {count}
    </span>

    <span class="min-w-0 flex-1 truncate text-t-bright" data-testid="page-label">
      {page?.title ?? page?.fallbackLabel ?? ''}
    </span>

    {#if !gameSessionStore.isOnLivePage}
      <button
        type="button"
        class="whitespace-nowrap px-1 text-t-muted/70 hover:text-t-bright"
        onclick={() => gameSessionStore.goToLivePage()}
        data-testid="page-latest"
      >
        [ latest ]
      </button>
    {/if}

    <button
      type="button"
      class="px-1 text-t-primary hover:text-t-bright disabled:opacity-30 disabled:hover:text-t-primary"
      onclick={() => gameSessionStore.nextPage()}
      disabled={atEnd}
      aria-label="Next page"
      data-testid="page-next"
    >
      &rsaquo;
    </button>
  </div>
{/if}
