<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { authStore } from '$lib/domain/auth-store.svelte';
</script>

<header class="border-b border-t-muted/30 pb-2 mb-4 flex items-center justify-between">
  <h1 class="text-xl font-bold">MYSTERY GAME TERMINAL</h1>
  <button
    type="button"
    class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted hover:border-t-primary hover:text-t-primary"
    onclick={() => authStore.signOut()}
  >
    LOGOUT
  </button>
</header>
