import fs from 'node:fs';
import { E2E_CONFIG_ROOT } from '../playwright.config';

export default function globalTeardown() {
	fs.rmSync(E2E_CONFIG_ROOT, { recursive: true, force: true });
}
