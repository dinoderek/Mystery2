<!--
	Settings: which AI narrates, chosen among mock and the AIs in ai.json, and,
	once a profile is chosen, the reading age its new games start at.

	Reachable without a profile — it sits in front of the picker, and a machine
	whose chosen AI is missing or broken is exactly the one that cannot get past
	it. It edits nothing in the file and shows no key: adding or changing an AI is
	editing ai.json and restarting. The reading age belongs to a profile, so it
	is shown, and its endpoint called, only when one is signed in.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { aiSettingsStore } from '$lib/domain/ai-settings-store.svelte';
	import { aiRows, narratorLine, overrideBanner } from '$lib/domain/ai-settings-view';
	import { playerStore } from '$lib/domain/player-store.svelte';
	import { profileSettingsStore } from '$lib/domain/profile-settings-store.svelte';
	import { readingAgeRows } from '$lib/domain/profile-settings-view';
	import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

	const settings = $derived(aiSettingsStore.state);
	const busy = $derived(aiSettingsStore.saving);
	const profile = $derived(playerStore.player);

	onMount(() => {
		aiSettingsStore.load();
		if (playerStore.player) profileSettingsStore.load();
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'b' || event.key === 'B') goto('/login');
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main
	class="bg-t-bg text-t-primary font-mono min-h-dvh p-4 flex flex-col max-w-3xl mx-auto"
>
	<div class="mb-4">
		<h1 class="text-2xl font-bold mb-2 text-t-bright">AI SETTINGS</h1>
		<p class="text-t-muted/70 border-b border-t-muted/30 pb-4">
			Which AI narrates. The list is ai.json; edit it and restart to change it.
		</p>
	</div>

	{#if aiSettingsStore.loading}
		<TerminalSpinner text="Loading settings..." />
	{:else if settings}
		{@const banner = overrideBanner(settings)}
		{@const narrator = narratorLine(settings)}
		{#if banner}
			<p
				class="text-t-warning border border-t-warning/40 p-3 mb-4 text-sm"
				data-testid="override-banner"
				role="status"
			>
				&gt; {banner}
			</p>
		{/if}

		<p
			class="mb-4 text-sm {narrator.error ? 'text-t-error' : 'text-t-muted'}"
			data-testid="narrator"
		>
			&gt; {narrator.text}
		</p>

		{#if aiSettingsStore.error}
			<p class="text-t-error mb-4 text-sm" role="alert">{aiSettingsStore.error}</p>
		{/if}

		<section class="flex-1">
			<p class="text-t-muted text-sm mb-2">&gt; NARRATION</p>
			<ul class="space-y-2">
				{#each aiRows(settings) as row (row.name)}
					<li>
						<button
							type="button"
							data-testid="ai-option"
							data-name={row.name}
							disabled={busy || row.problem !== null}
							aria-pressed={row.selected}
							onclick={() => aiSettingsStore.choose(row.name)}
							class="w-full border px-3 py-2 text-left font-mono focus:outline-none
								disabled:opacity-50 {row.selected
								? 'border-t-primary text-t-bright bg-t-primary/10'
								: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
						>
							[ {row.name} ]
							<span class="text-t-dim text-xs">{row.detail}</span>
						</button>
						{#if row.problem}
							<p class="text-t-warning text-xs mt-1" data-testid="ai-problem">{row.problem}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="text-t-error text-sm" role="alert">
			{aiSettingsStore.error ?? 'Could not load settings.'}
		</p>
	{/if}

	{#if profile}
		<section class="mt-8" data-testid="reading-age">
			<p class="text-t-muted text-sm mb-1">&gt; READING AGE FOR {profile.name.toUpperCase()}</p>
			<p class="text-t-dim text-xs mb-2">
				New games are written for this age. A game already started keeps its own.
			</p>
			{#if profileSettingsStore.loading}
				<TerminalSpinner text="Loading reading age..." />
			{:else}
				{#if profileSettingsStore.error}
					<p class="text-t-error mb-2 text-sm" role="alert">{profileSettingsStore.error}</p>
				{/if}
				{#if profileSettingsStore.state}
					<ul class="flex flex-wrap gap-2">
						{#each readingAgeRows(profileSettingsStore.state) as row (row.label)}
							<li>
								<button
									type="button"
									data-testid="reading-age-option"
									data-age={row.age ?? 'case'}
									disabled={profileSettingsStore.saving}
									aria-pressed={row.selected}
									onclick={() => profileSettingsStore.setReadingAge(row.age)}
									class="border px-3 py-2 text-left font-mono focus:outline-none
										disabled:opacity-50 {row.selected
										? 'border-t-primary text-t-bright bg-t-primary/10'
										: 'border-t-muted/30 text-t-primary hover:border-t-primary'}"
								>
									[ {row.label} ]
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
	{/if}

	<div class="mt-8 text-center">
		<button
			type="button"
			onclick={() => goto('/login')}
			class="border border-t-muted/40 px-3 py-1 text-xs text-t-muted
				hover:border-t-primary hover:text-t-primary focus:outline-none"
		>
			[ BACK ]
		</button>
		<p class="text-t-dim text-xs mt-2">[ PRESS B TO GO BACK ]</p>
	</div>
</main>
