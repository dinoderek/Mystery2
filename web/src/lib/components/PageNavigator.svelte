<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';

  const page = $derived(gameSessionStore.activePage);
  const count = $derived(gameSessionStore.pageCount);
  const number = $derived((page?.index ?? 0) + 1);
  const atStart = $derived(number <= 1);
  const atEnd = $derived(number >= count);
</script>

<!-- One thin row, and none until there is a second page to turn to. -->
{#if count > 1}
  <div class="flex h-11 shrink-0 items-center gap-1 text-xs" data-testid="page-navigator">
    <button
      type="button"
      class="h-11 w-11 shrink-0 text-base text-t-primary hover:text-t-bright disabled:opacity-30 disabled:hover:text-t-primary"
      onclick={() => gameSessionStore.prevPage()}
      disabled={atStart}
      aria-label="Previous page"
      data-testid="page-prev"
    >
      &lsaquo;
    </button>

    <span class="whitespace-nowrap text-t-muted/70" aria-label="Page {number} of {count}">{number}/{count}</span>

    <span class="min-w-0 flex-1 truncate text-t-bright" data-testid="page-label">
      {page?.title ?? page?.fallbackLabel ?? ''}
    </span>

    {#if !gameSessionStore.isOnLivePage}
      <button
        type="button"
        class="h-11 shrink-0 whitespace-nowrap px-1 text-t-muted/70 hover:text-t-bright"
        onclick={() => gameSessionStore.goToLivePage()}
        data-testid="page-latest"
      >
        [ latest ]
      </button>
    {/if}

    <button
      type="button"
      class="h-11 w-11 shrink-0 text-base text-t-primary hover:text-t-bright disabled:opacity-30 disabled:hover:text-t-primary"
      onclick={() => gameSessionStore.nextPage()}
      disabled={atEnd}
      aria-label="Next page"
      data-testid="page-next"
    >
      &rsaquo;
    </button>
  </div>
{/if}
