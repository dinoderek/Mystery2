<script lang="ts">
  let { text, type = 'system' } = $props<{ text: string, type?: 'system' | 'player' | 'character' }>();
</script>

<div class="mb-2 leading-relaxed {type === 'player' ? 'text-t-bright' : type === 'character' ? 'text-t-dialogue' : 'text-t-muted'}">
  {#if type === 'player'}
    <span class="opacity-50">&gt; </span>
  {/if}
  <span>{text}</span>
</div>
