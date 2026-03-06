<script lang="ts">
  let { text, type = 'system' } = $props<{ text: string, type?: 'system' | 'player' | 'character' }>();
</script>

<div class="mb-2 leading-relaxed {type === 'player' ? 'text-green-300' : type === 'character' ? 'text-yellow-400' : 'text-green-500'}">
  {#if type === 'player'}
    <span class="opacity-50">&gt; </span>
  {/if}
  <span>{text}</span>
</div>
