# Quickstart: Web UI

## Prerequisites

Ensure you have the following installed:
- Node.js (v20+)
- npm

The Supabase CLI and local backend must be running.

## Local Development Workflow

1. **Start the local backend**:
   From the repository root:
   ```bash
   npm run dev
   ```
   *Note: This script (if configured) or `npx supabase start` boots the Supabase stack.*

2. **Navigate to the web application**:
   ```bash
   cd web
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Start the Vite development server**:
   ```bash
   npm run dev
   ```

5. **Open the application**:
   Navigate to `http://localhost:5173` in your browser.

## Testing

Run component and unit tests:
```bash
npm run test:unit
```

Run end-to-end (E2E) Playwright tests:
```bash
npm run test:e2e
```
