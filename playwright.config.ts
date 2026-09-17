import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_FILE, loadConfig, totalTestTimeoutMs } from './helpers/config';

const config = loadConfig();

// Reuse the saved Microsoft 365 session when it exists; otherwise the test falls
// back to human-assisted sign-in and writes the session on the way out.
const storageState = fs.existsSync(AUTH_STATE_FILE) ? AUTH_STATE_FILE : undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: totalTestTimeoutMs(config),
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    // Headed by default: sign-in and MFA are completed by the tester.
    headless: false,
    storageState,
    baseURL: config.outlookUrl,
    viewport: { width: 1680, height: 1000 },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-outlook-web',
      use: { browserName: 'chromium', channel: 'chromium' },
    },
  ],
});
