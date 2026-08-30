// Which local profile is playing.
//
// There is nothing to keep in sync here — no token to refresh, no expiry to
// notice, no auth-state stream. The server holds the profile id in an httpOnly
// cookie; this asks it who that is.

export interface PlayerProfile {
	id: string;
	name: string;
}

interface PlayerResponse {
	player: PlayerProfile | null;
}

interface PlayersResponse {
	players: PlayerProfile[];
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
	const response = await fetch(url, init);
	if (!response.ok) return null;
	return (await response.json()) as T;
}

export class PlayerStore {
	player = $state<PlayerProfile | null>(null);
	/** Every profile on this machine, for the picker. */
	profiles = $state<PlayerProfile[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);

	/** Path the player was trying to reach before being sent to the picker. */
	intendedPath = $state<string | null>(null);

	/** Resolves the cookie into a profile, and loads the list to choose from. */
	async init(): Promise<void> {
		this.loading = true;
		try {
			const [current, all] = await Promise.all([
				readJson<PlayerResponse>('/api/player'),
				readJson<PlayersResponse>('/api/players'),
			]);
			this.player = current?.player ?? null;
			this.profiles = all?.players ?? [];
		} catch (thrown) {
			this.error = thrown instanceof Error ? thrown.message : String(thrown);
		} finally {
			this.loading = false;
		}
	}

	/** Signs in as `name`, creating that profile if it is new. */
	async signIn(name: string): Promise<boolean> {
		this.error = null;

		const trimmed = name.trim();
		if (!trimmed) {
			this.error = 'Enter a name';
			return false;
		}

		try {
			const response = await fetch('/api/player', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: trimmed }),
			});
			const payload = (await response.json().catch(() => null)) as
				| (PlayerResponse & { error?: string })
				| null;

			if (!response.ok || !payload?.player) {
				this.error = payload?.error ?? `Could not sign in (${response.status})`;
				return false;
			}

			this.player = payload.player;
			if (!this.profiles.some((profile) => profile.id === payload.player!.id)) {
				this.profiles = [...this.profiles, payload.player];
			}
			return true;
		} catch (thrown) {
			this.error = thrown instanceof Error ? thrown.message : String(thrown);
			return false;
		}
	}

	async signOut(): Promise<void> {
		this.error = null;
		try {
			await fetch('/api/player', { method: 'DELETE' });
			this.player = null;
		} catch (thrown) {
			this.error = thrown instanceof Error ? thrown.message : String(thrown);
		}
	}
}

export const playerStore = new PlayerStore();
