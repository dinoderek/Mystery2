<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
</script>

<header class="border-b border-green-500/30 pb-2 mb-4">
  <h1 class="text-xl font-bold">MYSTERY GAME TERMINAL</h1>
  <p class="text-xs text-green-500/60">ACTIVE SESSION ID: {gameSessionStore.game_id || 'UNKNOWN'}</p>
</header>
