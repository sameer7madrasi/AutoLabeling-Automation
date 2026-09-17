import { defineConfig } from '@playwright/test';

// Renders the weekly PM report locally. Independent of the Outlook E2E config:
// no tenant credentials, no .env, no network access required.
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 900, height: 1400 },
    // Charts are pasted into email at 650 px wide, so render at 2x for crispness.
    deviceScaleFactor: 2,
  },
  projects: [{ name: 'report', use: { browserName: 'chromium', channel: 'chromium' } }],
});
