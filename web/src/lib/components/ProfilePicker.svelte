<script lang="ts">
	import { readingAgeRows } from '$lib/domain/profile-settings-view';
	import { playerStore } from '$lib/domain/player-store.svelte';

	let name = $state('');
	let readingAge = $state<number | null>(null);
	let submitting = $state(false);
	// With profiles to pick from, the new-profile form waits behind a button.
	let creating = $state(false);
	const showForm = $derived(creating || playerStore.profiles.length === 0);

	async function signInAs(profileName: string, age: number | null = null) {
		submitting = true;
		const signedIn = await playerStore.signIn(profileName, age);
		submitting = false;
		return signedIn;
	}

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (submitting) return;
		if (await signInAs(name, readingAge)) {
			name = '';
			readingAge = null;
		}
	}
</script>

{#if playerStore.profiles.length > 0}
	<ul class="space-y-2 mb-4">
		{#each playerStore.profiles as profile (profile.id)}
			<li>
				<button
					type="button"
					data-testid="profile-option"
					disabled={submitting}
					onclick={() => signInAs(profile.name)}
					class="min-h-11 w-full border border-t-muted/30 px-3 py-2 text-left font-mono text-t-primary
						hover:border-t-primary focus:border-t-primary focus:outline-none disabled:opacity-50"
				>
					{profile.name}
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if showForm}
	<form onsubmit={handleSubmit} class="space-y-4">
		<div class="flex gap-2">
			<label for="profile-name" class="sr-only">Name</label>
			<input
				id="profile-name"
				type="text"
				bind:value={name}
				disabled={submitting}
				autocomplete="off"
				maxlength="60"
				class="min-h-11 min-w-0 flex-1 bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
					focus:border-t-primary focus:outline-none disabled:opacity-50"
				placeholder="name"
			/>
			<label for="profile-age" class="sr-only">Reading age</label>
			<select
				id="profile-age"
				data-testid="reading-age-select"
				disabled={submitting}
				bind:value={readingAge}
				class="min-h-11 bg-t-bg border border-t-muted/30 text-t-primary px-2 py-2 font-mono
					focus:border-t-primary focus:outline-none disabled:opacity-50"
			>
				<option value={null} disabled>AGE</option>
				{#each readingAgeRows(readingAge) as row (row.age)}
					<option value={row.age}>{row.label}</option>
				{/each}
			</select>
		</div>

		<button
			type="submit"
			disabled={submitting}
			class="min-h-11 w-full border border-t-primary px-3 py-2 font-mono text-t-bright
				hover:bg-t-primary/10 focus:outline-none disabled:opacity-50"
		>
			[ START ]
		</button>
	</form>
{:else}
	<button
		type="button"
		data-testid="new-profile"
		onclick={() => (creating = true)}
		class="min-h-11 w-full border border-t-primary px-3 py-2 font-mono text-t-bright
			hover:bg-t-primary/10 focus:outline-none"
	>
		[ NEW PROFILE ]
	</button>
{/if}

{#if playerStore.error}
	<p class="mt-4 text-t-error text-sm" role="alert">{playerStore.error}</p>
{/if}
