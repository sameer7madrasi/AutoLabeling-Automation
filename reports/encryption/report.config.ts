import { defineConfig } from '@playwright/test';

// Renders the encryption report locally: no tenant credentials, no .env, no network.
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 940, height: 1400 },
    // Charts are pasted into email at 650 px wide, so render at 2x for crispness.
    deviceScaleFactor: 2,
  },
  projects: [{ name: 'encryption-report', use: { browserName: 'chromium', channel: 'chromium' } }],
});
