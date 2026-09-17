import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const AUTH_STATE_FILE = path.join(PROJECT_ROOT, 'playwright', '.auth', 'user.json');
export const RESULTS_DIR = path.join(PROJECT_ROOT, 'results');
export const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'screenshots');

export interface TestConfig {
  testUserEmail: string;
  outlookUrl: string;
  expectedLabel: string;
  sitTrigger: string;
  emailArrivalTimeoutMs: number;
  labelTimeoutMs: number;
  pollIntervalMs: number;
  loginTimeoutMs: number;
  debugLabelLocator: boolean;
}

function requiredString(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and set your tenant values (see README).',
    );
  }
  return value;
}

function optionalString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number, received "${raw}".`);
  }
  return parsed;
}

export function loadConfig(): TestConfig {
  return {
    testUserEmail: requiredString('TEST_USER_EMAIL'),
    outlookUrl: optionalString('OUTLOOK_URL', 'https://outlook.office.com/mail/'),
    expectedLabel: optionalString('EXPECTED_LABEL', 'EnforcementTest-Label'),
    sitTrigger: optionalString('SIT_TRIGGER', 'SingleLocationScope-Enforcement-SIT'),
    emailArrivalTimeoutMs: optionalNumber('EMAIL_ARRIVAL_TIMEOUT_MINUTES', 10) * 60_000,
    labelTimeoutMs: optionalNumber('LABEL_TIMEOUT_MINUTES', 10) * 60_000,
    pollIntervalMs: optionalNumber('POLL_INTERVAL_SECONDS', 20) * 1_000,
    loginTimeoutMs: optionalNumber('LOGIN_TIMEOUT_MINUTES', 5) * 60_000,
    debugLabelLocator: optionalString('DEBUG_LABEL_LOCATOR', 'false').toLowerCase() === 'true',
  };
}

/**
 * The single test has to cover manual login, message delivery and asynchronous
 * policy enforcement, so the Playwright timeout is derived from those budgets
 * instead of being a magic number.
 */
export function totalTestTimeoutMs(config: TestConfig): number {
  const buffer = 3 * 60_000;
  return config.loginTimeoutMs + config.emailArrivalTimeoutMs + config.labelTimeoutMs + buffer;
}
