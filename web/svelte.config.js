import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The game is one Node process on the machine: the same server that
		// serves the SPA also serves `/api`, which is why nothing here needs
		// CORS, JWTs or signed URLs any more.
		adapter: adapter()
	}
};

export default config;
