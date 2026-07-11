import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// Temporary worktree config: port 5174 so tests don't hit the dev server of
// the main checkout on 5173. Not meant to be committed.
export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
