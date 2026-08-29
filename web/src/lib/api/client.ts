// The game API, same origin.
//
// Every call used to go through `supabase.functions.invoke()`, which returned
// `{ data, error }`; this keeps that shape so the retry classification in
// `store.retry.ts` and the call sites in the store barely change. What is gone
// is the JWT, the anon key, the cross-origin base URL, and the SDK.

export interface ApiFailure {
	message: string;
	/** HTTP status, when the request reached the server. */
	status?: number;
}

export interface ApiResult<T = unknown> {
	data: T | null;
	error: ApiFailure | null;
}

const API_BASE = '/api';

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
	const payload = await response.json().catch(() => null);

	if (!response.ok) {
		const message =
			payload && typeof payload === 'object' &&
			typeof (payload as { error?: unknown }).error === 'string'
				? (payload as { error: string }).error
				: `Request failed (${response.status})`;

		return { data: payload as T | null, error: { message, status: response.status } };
	}

	return { data: payload as T, error: null };
}

function asFailure(thrown: unknown): ApiResult<never> {
	// A thrown fetch is the network being unreachable, which `classifyFailure`
	// reads as transient and retries.
	return {
		data: null,
		error: { message: thrown instanceof Error ? thrown.message : String(thrown) },
	};
}

/** POST to a game endpoint. The body is always JSON, even when it is empty. */
export async function callApi<T = unknown>(
	endpoint: string,
	body: Record<string, unknown> = {},
): Promise<ApiResult<T>> {
	try {
		const response = await fetch(`${API_BASE}/${endpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return await readResult<T>(response);
	} catch (thrown) {
		return asFailure(thrown);
	}
}

/** GET a game endpoint, with the query it reads off the URL. */
export async function callApiGet<T = unknown>(
	endpoint: string,
	query: Record<string, string> = {},
): Promise<ApiResult<T>> {
	const search = new URLSearchParams(query).toString();
	const url = search ? `${API_BASE}/${endpoint}?${search}` : `${API_BASE}/${endpoint}`;

	try {
		return await readResult<T>(await fetch(url, { method: 'GET' }));
	} catch (thrown) {
		return asFailure(thrown);
	}
}

/** URL the browser fetches a blueprint image from. */
export function blueprintImageUrl(blueprintId: string, imageId: string): string {
	return `${API_BASE}/images/${encodeURIComponent(blueprintId)}/${encodeURIComponent(imageId)}`;
}
