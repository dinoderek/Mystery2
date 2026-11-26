<!--
	The one-line footer under a menu or list: an optional `[ BACK ]` and a key
	hint, shown only to a fine pointer. Fixed height, so the list above keeps its
	space on a phone; with nothing to show, it takes none.
-->
<script lang="ts">
	let { hint, onback }: { hint: string; onback?: () => void } = $props();
</script>

<div
	class="mt-3 h-11 shrink-0 items-center justify-center gap-3 text-sm text-t-muted/60
		{onback ? 'flex' : 'hidden pointer-fine:flex'}"
>
	{#if onback}
		<button
			type="button"
			data-testid="back-button"
			class="h-11 shrink-0 whitespace-nowrap border border-t-muted/40 px-3 hover:border-t-primary hover:text-t-primary"
			onclick={onback}
		>
			[ BACK ]
		</button>
	{/if}
	<span class="hidden pointer-fine:inline min-w-0 truncate animate-pulse">[ {hint} ]</span>
</div>
