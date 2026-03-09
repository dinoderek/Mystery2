<script lang="ts">
	import { authStore } from '$lib/domain/auth-store.svelte';

	let email = $state('');
	let password = $state('');
	let submitting = $state(false);
	let validationErrors = $state<{ email?: string; password?: string }>({});

	function validate(): boolean {
		const errors: { email?: string; password?: string } = {};

		if (!email.trim()) {
			errors.email = 'Email is required';
		}
		if (!password) {
			errors.password = 'Password is required';
		}

		validationErrors = errors;
		return Object.keys(errors).length === 0;
	}

	async function handleSubmit(event: Event) {
		event.preventDefault();

		if (!validate()) return;

		submitting = true;
		await authStore.signIn(email.trim(), password);
		submitting = false;
	}
</script>

<form onsubmit={handleSubmit} class="space-y-6">
	<div>
		<label for="email" class="block text-t-muted text-sm mb-1">&gt; EMAIL</label>
		<input
			id="email"
			type="email"
			bind:value={email}
			disabled={submitting}
			autocomplete="email"
			class="w-full bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
				focus:border-t-primary focus:outline-none disabled:opacity-50"
			placeholder="agent@mystery.local"
		/>
		{#if validationErrors.email}
			<p class="text-t-error text-sm mt-1">{validationErrors.email}</p>
		{/if}
	</div>

	<div>
		<label for="password" class="block text-t-muted text-sm mb-1">&gt; PASSWORD</label>
		<input
			id="password"
			type="password"
			bind:value={password}
			disabled={submitting}
			autocomplete="current-password"
			class="w-full bg-transparent border border-t-muted/30 text-t-primary px-3 py-2 font-mono
				focus:border-t-primary focus:outline-none disabled:opacity-50"
			placeholder="••••••••"
		/>
		{#if validationErrors.password}
			<p class="text-t-error text-sm mt-1">{validationErrors.password}</p>
		{/if}
	</div>

	{#if authStore.error}
		<div class="border border-t-error/30 bg-t-error/5 p-3 text-t-error text-sm">
			{authStore.error}
		</div>
	{/if}

	<button
		type="submit"
		disabled={submitting}
		class="w-full border border-t-primary text-t-primary py-2 font-mono
			hover:bg-t-primary hover:text-t-bg transition-colors
			disabled:opacity-50 disabled:cursor-not-allowed"
	>
		{submitting ? '[ AUTHENTICATING... ]' : '[ LOGIN ]'}
	</button>
</form>
