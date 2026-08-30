import type { PlayerRecord } from '@my2/game-engine';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** The local profile this request runs as, or null when signed out. */
			player: PlayerRecord | null;
		}
	}
}

export {};
