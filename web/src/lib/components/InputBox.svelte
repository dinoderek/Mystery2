<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  
  let inputValue = $state('');
  
  let placeholder = $derived(
    gameSessionStore.state?.mode === 'talk' ? '> Talk mode...' :
    gameSessionStore.state?.mode === 'accuse' ? '> Accuse mode...' :
    '> Explore mode...'
  );

  let disabled = $derived(gameSessionStore.status === 'loading');

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && inputValue.trim()) {
      const text = inputValue;
      inputValue = '';
      await gameSessionStore.submitInput(text);
    }
  }
</script>

<div class="mt-4 border-t border-green-500/30 pt-4">
  <input 
    type="text" 
    bind:value={inputValue}
    onkeydown={handleKeydown}
    {placeholder}
    {disabled}
    class="w-full bg-transparent border-none outline-none text-green-300 placeholder-green-500/50 font-mono disabled:opacity-50"
    autocomplete="off"
    spellcheck="false"
    autofocus
  />
</div>
