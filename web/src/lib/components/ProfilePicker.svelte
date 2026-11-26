<script lang="ts">
	import AgePicker from '$lib/components/AgePicker.svelte';
	import { playerStore } from '$lib/domain/player-store.svelte';

	let name = $state('');
	let readingAge = $state<number | null>(null);
	let submitting = $state(false);

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
	<div class="mb-6">
		<p class="text-t-muted text-sm mb-2">&gt; CHOOSE A PROFILE</p>
		<ul class="space-y-2">
			{#each playerStore.profiles as profile (profile.id)}
				<li>
					<button
						type="button"
						data-testid="profile-option"
						disabled={submitting}
						onclick={() => signInAs(profile.name)}
						class="w-full border border-t-muted/30 px-3 py-2 text-left font-mono text-t-primary
							hover:border-t-primary focus:border-t-primary focus:outline-none disabled:opacity-50"
					>
						{profile.name}
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<form onsubmit={handleSubmit} class="space-y-4">
	<div>
		<label for="profile-name" class="block text-t-muted text-sm mb-1">&gt; NEW PROFILE</label>
		<input
			id="profile-name"
			type="text"
			bind:value={name}
			disabled={submitting}
			autocomplete="off"
			maxlength="60"
			class="w-full bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
				focus:border-t-primary focus:outline-none disabled:opacity-50"
			placeholder="detective"
		/>
	</div>

	<div>
		<p class="block text-t-muted text-sm mb-1">&gt; READING AGE (A NEW PROFILE NEEDS ONE)</p>
		<AgePicker selected={readingAge} disabled={submitting} onchoose={(age) => (readingAge = age)} />
	</div>

	<button
		type="submit"
		disabled={submitting}
		class="w-full border border-t-primary px-3 py-2 font-mono text-t-bright
			hover:bg-t-primary/10 focus:outline-none disabled:opacity-50"
	>
		[ START ]
	</button>

	{#if playerStore.error}
		<p class="text-t-error text-sm" role="alert">{playerStore.error}</p>
	{/if}
</form>
