<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ProfilePicker from '$lib/components/ProfilePicker.svelte';
	import { aiSettingsStore } from '$lib/domain/ai-settings-store.svelte';
	import { narratorLine } from '$lib/domain/ai-settings-view';

	// Named before a game starts, so a game never narrates with an AI the
	// player did not expect, mock included.
	const narrator = $derived(aiSettingsStore.state ? narratorLine(aiSettingsStore.state) : null);

	onMount(() => {
		aiSettingsStore.load();
	});
</script>

<main class="min-h-dvh bg-t-bg text-t-primary font-mono flex items-center justify-center p-8">
	<div class="w-full max-w-md border border-t-muted/30 p-8 rounded">
		<h1 class="text-2xl font-bold mb-2 text-t-bright">MYSTERY GAME TERMINAL</h1>
		<p class="text-t-muted/70 mb-8 border-b border-t-muted/30 pb-4">
			Who is playing?
		</p>

		<ProfilePicker />

		<p class="mt-6 text-center text-t-dim text-xs">
			[ PROFILES ARE LOCAL TO THIS MACHINE ]
		</p>

		<div class="mt-4 text-center">
			{#if narrator}
				<p
					class="mb-2 text-xs {narrator.error ? 'text-t-error' : 'text-t-dim'}"
					data-testid="narrator"
				>
					[ {narrator.text} ]
				</p>
			{:else if aiSettingsStore.error}
				<p class="mb-2 text-xs text-t-error" data-testid="narrator">
					[ NARRATOR UNKNOWN: {aiSettingsStore.error} ]
				</p>
			{/if}
			<button
				type="button"
				data-testid="settings-link"
				onclick={() => goto('/settings')}
				class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted
					hover:border-t-primary hover:text-t-primary focus:outline-none"
			>
				[ AI SETTINGS ]
			</button>
		</div>
	</div>
</main>
