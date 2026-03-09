import { setupTestAuth } from '../../testkit/src/auth';

export const API_URL = 'http://127.0.0.1:54331/functions/v1';
export const REST_URL = 'http://127.0.0.1:54331/rest/v1';

export type ApiAuthContext = Awaited<ReturnType<typeof setupTestAuth>>;

export async function setupApiTestAuth(tag: string): Promise<ApiAuthContext> {
	const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`;
	return setupTestAuth(email, 'password123');
}
