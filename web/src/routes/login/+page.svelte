<script lang="ts">
	import ProfilePicker from '$lib/ui/ProfilePicker.svelte';
</script>

<main class="min-h-screen bg-t-bg text-t-primary font-mono flex items-center justify-center p-8">
	<div class="w-full max-w-md border border-t-muted/30 p-8 rounded">
		<h1 class="text-2xl font-bold mb-2 text-t-bright">MYSTERY GAME TERMINAL</h1>
		<p class="text-t-muted/70 mb-8 border-b border-t-muted/30 pb-4">
			Who is playing?
		</p>

		<ProfilePicker />

		<p class="mt-6 text-center text-t-dim text-xs">
			[ PROFILES ARE LOCAL TO THIS MACHINE ]
		</p>
	</div>
</main>
