import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  buildCharts,
  buildSummary,
  renderReportHtml,
  type HistoryFile,
  type Summary,
  type TestCaseFile,
} from './charts';

const REPORTS_DIR = __dirname;
const DATA_DIR = path.join(REPORTS_DIR, 'data');
const CHARTS_DIR = path.join(REPORTS_DIR, 'charts');
const HTML_PATH = path.join(REPORTS_DIR, 'weekly-report.html');
const SUMMARY_PATH = path.join(DATA_DIR, 'summary.json');
const EMAIL_PATH = path.join(REPORTS_DIR, 'email-draft.md');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

test('build weekly report charts, summary and consistency checks', async ({ page }) => {
  const data = readJson<TestCaseFile>(path.join(DATA_DIR, 'test-cases.json'));
  const history = readJson<HistoryFile>(path.join(DATA_DIR, 'automation-history.json'));
  const summary = buildSummary(data, history);

  assertInternallyConsistent(summary, data, history);

  fs.mkdirSync(CHARTS_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const charts = buildCharts(summary);
  const generatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(HTML_PATH, renderReportHtml(summary, charts, generatedAt), 'utf8');

  await page.goto(`file://${HTML_PATH}`, { waitUntil: 'load' });

  for (const chart of charts) {
    const element = page.locator(`[data-chart="${chart.slug}"]`);
    await expect(element).toBeVisible();
    await element.screenshot({ path: path.join(CHARTS_DIR, `${chart.slug}.png`) });
  }

  assertEmailDraftMatchesData(summary);
  printSummary(summary, charts.map((chart) => chart.slug));
});

/** The email narrative is only trustworthy if these hold. */
function assertInternallyConsistent(summary: Summary, data: TestCaseFile, history: HistoryFile): void {
  expect(summary.total, 'case count').toBe(data.cases.length);
  expect(summary.passed + summary.tbc + summary.clarification, 'statuses cover every case').toBe(summary.total);
  expect(summary.open, 'open = tbc + clarification').toBe(summary.tbc + summary.clarification);
  expect(summary.openItems, 'one row per open case').toHaveLength(summary.open);
  expect(
    summary.sections.reduce((sum, section) => sum + section.total, 0),
    'sections cover every case',
  ).toBe(summary.total);
  expect(
    summary.tiers.reduce((sum, tier) => sum + tier.count, 0),
    'tiers cover every case',
  ).toBe(summary.total);
  expect(
    summary.byPriority.reduce((sum, priority) => sum + priority.total, 0),
    'priorities cover every case',
  ).toBe(summary.total);

  for (const section of summary.sections) {
    expect(section.pass + section.tbc + section.clarification, `${section.key} statuses sum`).toBe(section.total);
  }

  const latestActual = history.actuals.at(-1);
  expect(latestActual, 'tracker has at least one actual data point').toBeDefined();
  expect(summary.automatedCount, 'tracker matches the automated case count').toBe(latestActual?.automated);

  // Anything marked automated must be a scenario we can actually run today.
  const tierOne = summary.tiers.find((tier) => tier.tier === 1);
  for (const id of summary.automatedIds) {
    expect(tierOne?.ids, `${id} is Tier 1`).toContain(id);
  }
  expect(summary.tracker.targets.map((target) => target.automated), 'targets never regress').toEqual(
    [...summary.tracker.targets.map((target) => target.automated)].sort((a, b) => a - b),
  );
  expect(
    Math.max(...summary.tracker.targets.map((target) => target.automated)),
    'targets stay within what is automatable without portal work',
  ).toBeLessThanOrEqual(history.tierOneAndTwoCeiling);
}

/** Guards the headline figures quoted in the email against the data. */
function assertEmailDraftMatchesData(summary: Summary): void {
  if (!fs.existsSync(EMAIL_PATH)) {
    console.log('[report] email-draft.md not present yet - skipping narrative cross-check.');
    return;
  }
  const draft = fs.readFileSync(EMAIL_PATH, 'utf8');
  const required = [
    `${summary.passed} of ${summary.total}`,
    `${summary.automatedCount} of ${summary.total}`,
    `${summary.open} open`,
  ];
  for (const phrase of required) {
    expect(draft, `email draft should quote "${phrase}"`).toContain(phrase);
  }
}

function printSummary(summary: Summary, slugs: string[]): void {
  const lines = [
    '',
    '='.repeat(58),
    'WEEKLY REPORT BUILD',
    '='.repeat(58),
    `Scenarios:        ${summary.total}`,
    `Passing:          ${summary.passed}`,
    `TBC:              ${summary.tbc}`,
    `Clarification:    ${summary.clarification}`,
    `Automated:        ${summary.automatedCount} (${summary.automatedPercent}%)`,
    '',
    'Tiers:',
    ...summary.tiers.map((tier) => `  Tier ${tier.tier} ${tier.label.padEnd(26)} ${tier.count}`),
    '',
    'Sections:',
    ...summary.sections.map(
      (section) =>
        `  ${section.key} ${section.short.padEnd(28)} ${section.pass}/${section.total} passing`,
    ),
    '',
    `Charts written:   ${slugs.length}`,
    ...slugs.map((slug) => `  reports/charts/${slug}.png`),
    '='.repeat(58),
    '',
  ];
  console.log(lines.join('\n'));
}
