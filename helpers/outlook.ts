import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { AUTH_STATE_FILE, type TestConfig } from './config';

/**
 * Every Outlook Web element used by the test is looked up through a list of
 * candidate locators, ordered from most to least specific. Tenants run slightly
 * different OWA builds, so if one accessible name changes the next candidate
 * still resolves. This is the only place that needs editing when the UI moves.
 */
type LocatorFactory = (page: Page) => Locator;

const NEW_MAIL_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('button', { name: /^new mail/i }),
  (page) => page.getByRole('menuitem', { name: /^new mail/i }),
  (page) => page.locator('[aria-label^="New mail" i]'),
  // Classic-ribbon OWA labels the compose split button simply "New".
  (page) => page.locator('[data-automation-type="RibbonSplitButton"][aria-label="New"]'),
  (page) => page.getByRole('button', { name: 'New', exact: true }),
];

const RECIPIENT_FIELD_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('textbox', { name: /^to\b/i }),
  (page) => page.getByRole('combobox', { name: /^to\b/i }),
  (page) => page.locator('[aria-label^="To" i][contenteditable="true"]'),
  (page) => page.locator('div[aria-label="To"] input, input[aria-label="To"]'),
];

const SUBJECT_FIELD_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('textbox', { name: /^(add a )?subject/i }),
  (page) => page.locator('input[aria-label^="Subject" i], input[aria-label^="Add a subject" i]'),
];

const BODY_FIELD_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('textbox', { name: /message body/i }),
  (page) => page.locator('[aria-label="Message body" i]'),
  (page) => page.locator('div[role="textbox"][contenteditable="true"]').last(),
];

const SEND_BUTTON_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('button', { name: /^send$/i }),
  (page) => page.locator('button[aria-label^="Send" i]'),
];

const MAILBOX_READY_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('button', { name: /^new mail/i }),
  (page) => page.locator('[aria-label="Message list" i]'),
  (page) => page.locator('div[role="main"] [role="listbox"]'),
];

const SEARCH_BOX_CANDIDATES: LocatorFactory[] = [
  (page) => page.getByRole('combobox', { name: /search/i }),
  (page) => page.getByRole('searchbox'),
  (page) => page.locator('input[aria-label*="Search" i]'),
];

const READING_PANE_CANDIDATES: LocatorFactory[] = [
  (page) => page.locator('[aria-label="Reading Pane" i]'),
  (page) => page.locator('#ReadingPaneContainerId'),
  (page) => page.locator('div[role="main"]'),
];

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  /** Called before each retry so callers can refresh / re-open the mailbox. */
  onRetry?: (attempt: number) => Promise<void>;
  onTick?: (attempt: number, elapsedMs: number) => void;
}

/** Polls `probe` until it returns a non-null value or the timeout expires. */
async function pollUntil<T>(probe: () => Promise<T | null>, options: PollOptions): Promise<T | null> {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const startedAt = Date.now();
    options.onTick?.(attempt, options.timeoutMs - (deadline - startedAt));

    try {
      const value = await probe();
      if (value !== null) return value;
    } catch {
      // Outlook re-renders aggressively; a failed probe is retried.
    }

    if (Date.now() + options.intervalMs >= deadline) break;
    if (options.onRetry) {
      await options.onRetry(attempt).catch(() => undefined);
    }
    const remaining = options.intervalMs - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns the first candidate locator that becomes visible, or throws a descriptive error. */
async function resolveVisible(
  page: Page,
  candidates: LocatorFactory[],
  description: string,
  timeoutMs = 30_000,
): Promise<Locator> {
  const resolved = await pollUntil<Locator>(
    async () => {
      for (const candidate of candidates) {
        const locator = candidate(page).first();
        if (await locator.isVisible().catch(() => false)) return locator;
      }
      return null;
    },
    { timeoutMs, intervalMs: 500 },
  );

  if (!resolved) {
    throw new Error(
      `Could not find "${description}" in Outlook Web within ${Math.round(timeoutMs / 1000)}s. ` +
        `Update the ${description} candidate locators in helpers/outlook.ts if your tenant renders it differently.`,
    );
  }
  return resolved;
}

async function isMailboxReady(page: Page): Promise<boolean> {
  for (const candidate of MAILBOX_READY_CANDIDATES) {
    if (await candidate(page).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

/** Narrowest visible reading-pane scope, so label lookups ignore the message list. */
async function readingPane(page: Page): Promise<Locator> {
  for (const candidate of READING_PANE_CANDIDATES) {
    const locator = candidate(page).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return page.locator('body');
}

/**
 * Opens Outlook Web, reusing a saved session when possible. If the mailbox does
 * not load, the tester is asked to complete Microsoft login / MFA by hand -
 * passwords and MFA are never automated.
 */
export async function ensureAuthenticated(page: Page, config: TestConfig): Promise<void> {
  await page.goto(config.outlookUrl, { waitUntil: 'domcontentloaded' });

  const reusedSession = await pollUntil(
    async () => ((await isMailboxReady(page)) ? true : null),
    { timeoutMs: 25_000, intervalMs: 1_000 },
  );

  if (reusedSession) {
    console.log('[auth] Reused the saved Outlook session.');
    await saveStorageState(page);
    return;
  }

  console.log(
    [
      '',
      '='.repeat(60),
      'ACTION REQUIRED: sign in to Outlook Web in the opened browser.',
      `Account to use: ${config.testUserEmail}`,
      'Complete the Microsoft password + MFA prompts manually.',
      'Choose "Stay signed in" so the session can be reused next run.',
      `Waiting up to ${Math.round(config.loginTimeoutMs / 60_000)} minute(s) for the mailbox to load...`,
      '='.repeat(60),
      '',
    ].join('\n'),
  );

  const signedIn = await pollUntil(
    async () => ((await isMailboxReady(page)) ? true : null),
    {
      timeoutMs: config.loginTimeoutMs,
      intervalMs: 2_000,
      onTick: (attempt) => {
        if (attempt % 15 === 0) console.log('[auth] Still waiting for the Outlook mailbox to load...');
      },
    },
  );

  if (!signedIn) {
    throw new Error(
      'Outlook Web mailbox never loaded. Sign-in was not completed in time, or the mailbox UI changed. ' +
        'Increase LOGIN_TIMEOUT_MINUTES and re-run, or check the MAILBOX_READY_CANDIDATES locators in helpers/outlook.ts.',
    );
  }

  console.log('[auth] Mailbox loaded - continuing automatically.');
  await saveStorageState(page);
}

async function saveStorageState(page: Page): Promise<void> {
  fs.mkdirSync(path.dirname(AUTH_STATE_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_STATE_FILE });
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
}

/** Composes and sends a plain-text email through the Outlook Web compose form. */
export async function sendEmail(page: Page, options: SendEmailOptions): Promise<void> {
  const newMailButton = await resolveVisible(page, NEW_MAIL_CANDIDATES, 'New mail button');
  await newMailButton.click();

  const recipientField = await resolveVisible(page, RECIPIENT_FIELD_CANDIDATES, 'To field');
  await recipientField.click();
  // Typed rather than filled: the recipient well is a contenteditable div whose
  // autocomplete only reacts to real keystrokes. Enter then resolves the pill.
  await recipientField.pressSequentially(options.to, { delay: 25 });
  await page.waitForTimeout(1_500);
  await page.keyboard.press('Enter');

  const subjectField = await resolveVisible(page, SUBJECT_FIELD_CANDIDATES, 'Subject field');
  await subjectField.click();
  await subjectField.fill(options.subject);

  const bodyField = await resolveVisible(page, BODY_FIELD_CANDIDATES, 'Message body');
  await bodyField.click();
  await bodyField.fill(options.body);

  const sendButton = await resolveVisible(page, SEND_BUTTON_CANDIDATES, 'Send button');
  await sendButton.click();

  // Compose surface closing is the signal that Outlook accepted the message.
  const composeClosed = await pollUntil(
    async () => ((await sendButton.isVisible().catch(() => false)) ? null : true),
    { timeoutMs: 30_000, intervalMs: 1_000 },
  );

  if (!composeClosed) {
    throw new Error(
      'Clicked Send but the compose window stayed open. Outlook may be showing a policy tip, ' +
        'an unresolved recipient, or a send error - check the failure screenshot.',
    );
  }
}

function messageListItems(page: Page, subject: string): Locator[] {
  const escaped = subject.replace(/"/g, '\\"');
  return [
    // Row aria-labels contain the full subject even when the text is truncated.
    page.locator(`div[role="option"][aria-label*="${escaped}"]`),
    page.getByRole('option').filter({ hasText: subject }),
    page.locator('div[role="listbox"] div[role="option"]').filter({ hasText: subject }),
  ];
}

async function findMessageRow(page: Page, subject: string): Promise<Locator | null> {
  for (const candidate of messageListItems(page, subject)) {
    const row = candidate.first();
    if (await row.isVisible().catch(() => false)) return row;
  }
  return null;
}

async function refreshInbox(page: Page): Promise<void> {
  const refreshButton = page.getByRole('button', { name: /^(refresh|sync this view)/i }).first();
  if (await refreshButton.isVisible().catch(() => false)) {
    await refreshButton.click();
    return;
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pollUntil(async () => ((await isMailboxReady(page)) ? true : null), {
    timeoutMs: 60_000,
    intervalMs: 1_000,
  });
}

/** Runs (or re-runs) an Outlook search for the exact subject of this run. */
async function searchForSubject(page: Page, subject: string): Promise<void> {
  const searchBox = await resolveVisible(page, SEARCH_BOX_CANDIDATES, 'Search box', 15_000);
  await searchBox.click();
  await searchBox.fill(subject);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2_000);
}

/**
 * Waits for the message with this run's unique subject to arrive and opens it.
 * The subject is generated per run, so a stale test email can never satisfy this.
 */
export async function waitForAndOpenMessage(
  page: Page,
  subject: string,
  config: TestConfig,
): Promise<void> {
  let useSearch = false;

  const row = await pollUntil<Locator>(() => findMessageRow(page, subject), {
    timeoutMs: config.emailArrivalTimeoutMs,
    intervalMs: config.pollIntervalMs,
    onTick: (attempt, elapsedMs) => {
      console.log(
        `[inbox] Attempt ${attempt}: looking for "${subject}" (${Math.round(elapsedMs / 1000)}s elapsed).`,
      );
    },
    onRetry: async (attempt) => {
      // Folder scanning is cheapest; Outlook search is the more reliable fallback.
      if (!useSearch && attempt >= 3) {
        useSearch = true;
        console.log('[inbox] Switching to Outlook search to locate the message.');
      }
      if (useSearch) {
        await searchForSubject(page, subject);
      } else {
        await refreshInbox(page);
      }
    },
  });

  if (!row) {
    throw new Error(
      `Email with subject "${subject}" did not appear within ` +
        `${Math.round(config.emailArrivalTimeoutMs / 60_000)} minute(s). ` +
        'Verify the message left the Sent Items folder and that mail flow to the test mailbox is healthy.',
    );
  }

  await row.click();
  const opened = await pollUntil(
    async () => {
      const pane = await readingPane(page);
      const visible = await pane
        .getByText(subject, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      return visible ? true : null;
    },
    { timeoutMs: 30_000, intervalMs: 1_000 },
  );

  if (!opened) {
    throw new Error(
      `Clicked the message row for "${subject}" but the reading pane never showed that subject. ` +
        'Check READING_PANE_CANDIDATES in helpers/outlook.ts.',
    );
  }
}

/** Re-opens the message so Outlook re-fetches header metadata, including the label. */
export async function reopenMessage(page: Page, subject: string, config: TestConfig): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pollUntil(async () => ((await isMailboxReady(page)) ? true : null), {
    timeoutMs: 60_000,
    intervalMs: 1_000,
  });
  await waitForAndOpenMessage(page, subject, {
    ...config,
    // Re-opening a message that already arrived should be fast.
    emailArrivalTimeoutMs: Math.min(config.emailArrivalTimeoutMs, 120_000),
  });
}

/**
 * Accessible names Outlook uses for the sensitivity chip vary by build, e.g.
 * "Sensitivity label: EnforcementTest-Label", "EnforcementTest-Label, Sensitivity label",
 * or "Change sensitivity label. Current label EnforcementTest-Label".
 */
/**
 * Some builds (classic-ribbon OWA) render the label as a bare text span next to a
 * shield icon, with no accessible name at all:
 *   <span><i data-icon-name="ShieldBundled"></i><span>EnforcementTest-Label</span></span>
 * The icon name is the only stable hook - the CSS classes are hashed per release.
 */
const LABEL_CHIP_SELECTORS = [
  'span:has(> i[data-icon-name="ShieldBundled"])',
  'span:has(i[data-icon-name*="Shield" i])',
  '[data-icon-name*="Sensitivity" i]',
];

const LABEL_NAME_PATTERNS: RegExp[] = [
  /sensitivity\s*label\s*[:\-]\s*(.+)$/i,
  /current\s*(?:sensitivity\s*)?label\s*(?:is)?\s*[:\-]?\s*(.+)$/i,
  /sensitivity\s*[:\-]\s*(.+)$/i,
  /^(.+?)\s*[,\-]\s*sensitivity(?:\s*label)?$/i,
  /^label\s*[:\-]\s*(.+)$/i,
];

const GENERIC_LABEL_WORDS = new Set(['sensitivity', 'label', 'sensitivity label', 'none', 'not set']);

/** Extracts a label name from an accessible name / title string. */
export function parseLabelFromAccessibleName(rawName: string): string | null {
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (!name) return null;

  for (const pattern of LABEL_NAME_PATTERNS) {
    const match = pattern.exec(name);
    const captured = match?.[1];
    if (!captured) continue;

    // Trim trailing instructional sentences and punctuation Outlook appends.
    const cleaned = captured
      .split(/(?:\.\s)|(?:\s{2,})/)[0]!
      .replace(/[.,;:]+$/, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();

    if (cleaned && !GENERIC_LABEL_WORDS.has(cleaned.toLowerCase())) return cleaned;
  }
  return null;
}

/**
 * Best-effort read of the sensitivity label shown on the opened message.
 * Returns null when no label-bearing element can be interpreted.
 */
export async function getSensitivityLabel(page: Page): Promise<string | null> {
  const pane = await readingPane(page);

  // Strategy 1: the shield-icon chip in the message header.
  for (const selector of LABEL_CHIP_SELECTORS) {
    const chips = pane.locator(selector);
    const chipCount = Math.min(await chips.count().catch(() => 0), 5);
    for (let index = 0; index < chipCount; index += 1) {
      const chip = chips.nth(index);
      if (!(await chip.isVisible().catch(() => false))) continue;
      const text = (await chip.innerText().catch(() => ''))?.replace(/\s+/g, ' ').trim();
      if (text && text.length <= 60 && !GENERIC_LABEL_WORDS.has(text.toLowerCase())) return text;
    }
  }

  // Strategy 2: accessible names that spell the label out.
  // Ordered from the most explicit annotation to the loosest one.
  const attributeSelectors = [
    '[aria-label*="sensitivity" i]',
    '[title*="sensitivity" i]',
    '[aria-label*="label" i]',
    '[title*="label" i]',
  ];

  for (const selector of attributeSelectors) {
    const elements = pane.locator(selector);
    const count = Math.min(await elements.count().catch(() => 0), 15);
    for (let index = 0; index < count; index += 1) {
      const element = elements.nth(index);
      if (!(await element.isVisible().catch(() => false))) continue;

      const names = [
        await element.getAttribute('aria-label').catch(() => null),
        await element.getAttribute('title').catch(() => null),
        await element.innerText().catch(() => null),
      ];

      for (const name of names) {
        if (!name) continue;
        const parsed = parseLabelFromAccessibleName(name);
        if (parsed) return parsed;
      }
    }
  }

  return null;
}

export interface LabelWaitResult {
  found: boolean;
  actualLabel: string | null;
}

/**
 * Polls the opened message until the expected label is applied. Auto-Labeling is
 * asynchronous, so the message is periodically re-opened to force Outlook to
 * re-read the header metadata. Returns as soon as the label matches.
 */
export async function waitForSensitivityLabel(
  page: Page,
  expectedLabel: string,
  timeoutMs: number,
  options: { intervalMs?: number; onRetry?: (attempt: number) => Promise<void> } = {},
): Promise<LabelWaitResult> {
  const normalizedExpected = expectedLabel.trim().toLowerCase();
  let lastObserved: string | null = null;

  const matched = await pollUntil<string>(
    async () => {
      const discovered = await getSensitivityLabel(page);
      if (discovered) {
        lastObserved = discovered;
        if (discovered.trim().toLowerCase() === normalizedExpected) return discovered;
      }

      // Some builds render the label as plain header text rather than a chip.
      const pane = await readingPane(page);
      const exactText = pane.getByText(expectedLabel, { exact: true }).first();
      if (await exactText.isVisible().catch(() => false)) {
        lastObserved = expectedLabel;
        return expectedLabel;
      }

      return null;
    },
    {
      timeoutMs,
      intervalMs: options.intervalMs ?? 20_000,
      onTick: (attempt, elapsedMs) => {
        console.log(
          `[label] Attempt ${attempt}: waiting for "${expectedLabel}"` +
            `${lastObserved ? ` (currently "${lastObserved}")` : ''} - ${Math.round(elapsedMs / 1000)}s elapsed.`,
        );
      },
      onRetry: options.onRetry,
    },
  );

  return { found: matched !== null, actualLabel: matched ?? lastObserved };
}

export interface LabelCandidate {
  tag: string;
  role: string | null;
  ariaLabel: string | null;
  title: string | null;
  text: string | null;
  testId: string | null;
}

/**
 * Collects every element that mentions sensitivity / label / enforcement so a
 * failing run explains itself instead of requiring a live debugging session.
 */
export async function collectLabelCandidates(page: Page): Promise<LabelCandidate[]> {
  return page
    .evaluate(() => {
      const pattern = /sensitiv|label|enforcement/i;
      const root = document.querySelector('div[role="main"]') ?? document.body;
      const seen = new Set<string>();
      const candidates: Record<string, string | null>[] = [];

      for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        const ariaLabel = element.getAttribute('aria-label');
        const title = element.getAttribute('title');
        const ownText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        const haystack = [ariaLabel, title, ownText].filter(Boolean).join(' | ');
        if (!haystack || haystack.length > 400 || !pattern.test(haystack)) continue;

        const entry = {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          ariaLabel,
          title,
          text: ownText || null,
          testId: element.getAttribute('data-testid') ?? element.getAttribute('data-automation-id'),
        };

        const key = JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(entry);
        if (candidates.length >= 60) break;
      }

      return candidates;
    })
    .then((raw) => raw as unknown as LabelCandidate[])
    .catch(() => []);
}

export function printLabelCandidates(candidates: LabelCandidate[]): void {
  if (candidates.length === 0) {
    console.log('[debug] No elements mentioning sensitivity/label/enforcement were found.');
    return;
  }
  console.log(`[debug] ${candidates.length} possible sensitivity-label element(s):`);
  for (const candidate of candidates) {
    const parts = [
      `<${candidate.tag}${candidate.role ? ` role="${candidate.role}"` : ''}>`,
      candidate.ariaLabel ? `aria-label="${candidate.ariaLabel}"` : null,
      candidate.title ? `title="${candidate.title}"` : null,
      candidate.testId ? `data-testid="${candidate.testId}"` : null,
      candidate.text ? `text="${candidate.text}"` : null,
    ].filter(Boolean);
    console.log(`  - ${parts.join(' ')}`);
  }
}