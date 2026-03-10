<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { formatLastPlayed, formatOutcome, pickSessionByNumericKey } from '$lib/domain/session-list';

  let message = $state<string | null>(null);

  const sessions = $derived(gameSessionStore.sessionCatalog.completed);

  onMount(() => {
    void gameSessionStore.loadSessionCatalog();
  });

  async function handleKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();

    if (key === 'b') {
      await goto('/');
      return;
    }

    const selected = pickSessionByNumericKey(event.key, sessions);
    if (!selected) {
      return;
    }

    if (!selected.can_open) {
      message = 'Cannot open: mystery file is unavailable.';
      return;
    }

    message = null;
    await gameSessionStore.resumeSession(selected.game_id);
    if (gameSessionStore.status === 'active') {
      await goto('/session');
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="min-h-screen bg-t-bg text-t-primary p-8 font-mono">
  <div class="max-w-3xl mx-auto border border-t-muted/30 p-8 rounded">
    <h1 class="text-2xl font-bold mb-2">COMPLETED SESSIONS</h1>
    <p class="text-t-muted/70 mb-6 border-b border-t-muted/30 pb-4">Pick a session number to review. Press `b` to go back.</p>

    {#if gameSessionStore.sessionCatalogStatus === 'loading' && sessions.length === 0}
      <p>Loading completed sessions...</p>
    {:else if sessions.length === 0}
      <p class="text-t-muted/80">No completed sessions found.</p>
    {:else}
      <div class="space-y-3">
        {#each sessions as session, i}
          <div class={`relative border p-4 ${session.can_open ? 'border-t-muted/20' : 'border-t-warning/40 opacity-70'}`}>
            <div class="absolute -left-3 -top-3 w-6 h-6 bg-t-bg border border-t-primary flex items-center justify-center font-bold">
              {i + 1}
            </div>
            <p class="font-bold text-t-bright">{session.mystery_title}</p>
            <p class="text-sm text-t-muted/90">Outcome: {formatOutcome(session.outcome)}</p>
            <p class="text-xs text-t-muted/80">Last played: {formatLastPlayed(session.last_played_at)}</p>
            {#if !session.can_open}
              <p class="text-xs text-t-warning mt-2">Cannot open: mystery file is unavailable.</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if message}
      <p class="mt-4 text-sm text-t-warning">{message}</p>
    {/if}

    <p class="mt-8 text-center text-t-muted/60 animate-pulse">[ PRESS NUMBER TO REVIEW OR B TO RETURN ]</p>
  </div>
</main>
