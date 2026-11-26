<!--
	Asks for a reading age when the engine refused a game because the profile has
	none (a local database from before the age was required). Choosing one carries
	on with what was refused: the game starts, reopens or plays the line again.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AgePicker from '$lib/components/AgePicker.svelte';
	import { gameSessionStore } from '$lib/domain/store.svelte';
	import { profileSettingsStore } from '$lib/domain/profile-settings-store.svelte';

	/** Moves focus into the prompt when it opens, as a modal does. */
	function focusFirstAge(node: HTMLElement) {
		void tick().then(() => node.querySelector<HTMLButtonElement>('button')?.focus());
	}

	async function choose(age: number) {
		const took = await gameSessionStore.chooseReadingAge(age);
		// A game started or reopened from a list opens on its own screen.
		if (took && gameSessionStore.status === 'active' && $page.url.pathname !== '/session') {
			await goto('/session');
		}
	}
</script>

{#if gameSessionStore.needsReadingAge}
	<div
		use:focusFirstAge
		class="fixed inset-0 z-[60] flex items-center justify-center bg-t-bg/90 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="reading-age-prompt-title"
		data-testid="reading-age-prompt"
	>
		<div class="w-full max-w-md border border-t-primary bg-t-bg p-6 font-mono text-t-primary">
			<h2 id="reading-age-prompt-title" class="mb-2 text-lg font-bold text-t-bright">
				HOW OLD IS THE READER?
			</h2>
			<p class="mb-4 text-sm text-t-muted">
				Stories are written for the age you choose. You can change it on the settings page.
			</p>
			{#if profileSettingsStore.error}
				<p class="mb-2 text-sm text-t-error" role="alert">{profileSettingsStore.error}</p>
			{/if}
			<AgePicker disabled={profileSettingsStore.saving} onchoose={choose} />
		</div>
	</div>
{/if}
