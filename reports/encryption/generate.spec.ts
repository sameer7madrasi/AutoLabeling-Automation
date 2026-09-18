import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  buildCharts,
  buildSummary,
  renderReportHtml,
  type AutomationPlan,
  type EncryptionData,
  type EncryptionSummary,
  type WeeklyHistory,
} from './charts';

const REPORT_DIR = __dirname;
const DATA_DIR = path.join(REPORT_DIR, 'data');
const CHARTS_DIR = path.join(REPORT_DIR, 'charts');
const HTML_PATH = path.join(REPORT_DIR, 'encryption-report.html');
const SUMMARY_PATH = path.join(DATA_DIR, 'summary.json');
const EMAIL_PATH = path.join(REPORT_DIR, 'email-draft.md');

/** Counts of status-bearing rows per workbook tab, as extracted from the sheet. */
const EXPECTED_POPULATED: Record<string, number> = {
  'EO-Label': 210,
  'EO-Subject': 210,
  'EO-Options': 210,
  'DNF-Label': 140,
  'DNF-Subject': 140,
  'DNF-Default template': 140,
  'IC-Label': 210,
  'IC-Subject': 210,
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

test('build encryption report charts, summary and reconciliation checks', async ({ page }) => {
  const data = readJson<EncryptionData>(path.join(DATA_DIR, 'test-cases.json'));
  const history = readJson<WeeklyHistory>(path.join(DATA_DIR, 'weekly-history.json'));
  const plan = readJson<AutomationPlan>(path.join(DATA_DIR, 'automation-plan.json'));
  const summary = buildSummary(data, history, plan);

  reconcileWithWorkbook(data, summary, history);

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

/** The report is only defensible if these reconcile with the source workbook. */
function reconcileWithWorkbook(
  data: EncryptionData,
  summary: EncryptionSummary,
  history: WeeklyHistory,
): void {
  const { populated, pass, fail, notApplicable, executed, passRate } = data.totals;

  expect(data.cases, 'one record per populated case').toHaveLength(populated);
  expect(pass + fail + notApplicable, 'statuses cover every populated case').toBe(populated);
  expect(executed, 'executed = pass + fail').toBe(pass + fail);
  expect(passRate, 'pass rate is computed over executed cases').toBe(
    Math.round((pass / executed) * 1000) / 10,
  );

  // Per-tab populated counts: the three DNF tabs legitimately hold 140, not 210.
  for (const [category, expectedCount] of Object.entries(EXPECTED_POPULATED)) {
    const meta = data.categories.find((entry) => entry.category === category);
    expect(meta, `${category} present`).toBeDefined();
    expect(meta?.populated, `${category} populated rows`).toBe(expectedCount);
    expect(meta?.plannedTcIds, `${category} planned TC ids`).toBe(210);
    expect(
      (meta?.pass ?? 0) + (meta?.fail ?? 0) + (meta?.notApplicable ?? 0),
      `${category} statuses sum to populated`,
    ).toBe(expectedCount);
    expect(
      data.cases.filter((entry) => entry.category === category),
      `${category} case records`,
    ).toHaveLength(expectedCount);
  }

  const placeholders = Object.values(EXPECTED_POPULATED).reduce(
    (sum, count) => sum + (210 - count),
    0,
  );
  expect(data.placeholderRows.count, 'placeholder rows accounted for').toBe(placeholders);
  expect(populated + placeholders, 'populated plus placeholders equal the planned matrix').toBe(1680);

  // Per-category pass rates must match what the category metadata claims.
  for (const meta of data.categories) {
    const cases = data.cases.filter((entry) => entry.category === meta.category);
    const recomputed = {
      pass: cases.filter((entry) => entry.status === 'Pass').length,
      fail: cases.filter((entry) => entry.status === 'Fail').length,
      na: cases.filter((entry) => entry.status === 'NA').length,
    };
    expect(recomputed.pass, `${meta.category} pass`).toBe(meta.pass);
    expect(recomputed.fail, `${meta.category} fail`).toBe(meta.fail);
    expect(recomputed.na, `${meta.category} not applicable`).toBe(meta.notApplicable);
    expect(
      Math.round((meta.pass / meta.executed) * 1000) / 10,
      `${meta.category} pass rate`,
    ).toBe(meta.passRate);
  }

  expect(
    summary.tiers.reduce((sum, tier) => sum + tier.count, 0),
    'automation tiers cover every case',
  ).toBe(populated);
  expect(
    summary.defects.reduce((sum, defect) => sum + defect.count, 0),
    'defect classes cover every failure',
  ).toBe(fail);

  const week0 = history.weeks[0];
  expect(week0, 'baseline cycle present').toBeDefined();
  expect(week0?.pass, 'baseline pass matches the sheet').toBe(pass);
  expect(week0?.fail, 'baseline fail matches the sheet').toBe(fail);
  expect(week0?.passRate, 'baseline pass rate matches the sheet').toBe(passRate);
  expect(week0?.coverage, 'baseline coverage matches the sheet').toBe(
    Math.round((executed / populated) * 1000) / 10,
  );
  expect(week0?.openDefectClasses, 'baseline defect classes match').toBe(summary.defects.length);
  for (const meta of data.categories) {
    expect(week0?.byCategory[meta.category], `${meta.category} baseline pass rate`).toBe(meta.passRate);
  }
}

/** Guards the headline figures quoted in the email against the data. */
function assertEmailDraftMatchesData(summary: EncryptionSummary): void {
  if (!fs.existsSync(EMAIL_PATH)) {
    console.log('[encryption-report] email-draft.md not present yet - skipping narrative cross-check.');
    return;
  }
  const draft = fs.readFileSync(EMAIL_PATH, 'utf8');
  const required = [
    `${summary.totals.populated.toLocaleString()}`,
    `${summary.totals.executed.toLocaleString()} executed`,
    `${summary.totals.passRate.toFixed(1)}%`,
    `${summary.totals.fail} failures`,
    `${summary.automatableNow} cases`,
  ];
  for (const phrase of required) {
    expect(draft, `email draft should quote "${phrase}"`).toContain(phrase);
  }
}

function printSummary(summary: EncryptionSummary, slugs: string[]): void {
  const lines = [
    '',
    '='.repeat(60),
    'ENCRYPTION REPORT BUILD',
    '='.repeat(60),
    `Populated cases:   ${summary.totals.populated}`,
    `Executed:          ${summary.totals.executed}`,
    `Pass / Fail / NA:  ${summary.totals.pass} / ${summary.totals.fail} / ${summary.totals.notApplicable}`,
    `Pass rate:         ${summary.totals.passRate.toFixed(1)}%`,
    `Placeholder rows:  ${summary.placeholderRows.count} (${summary.placeholderRows.tabs.join(', ')})`,
    '',
    'Categories (worst first):',
    ...summary.categories.map(
      (category) =>
        `  ${category.category.padEnd(22)} ${String(category.populated).padStart(4)} cases  ${String(category.passRate).padStart(5)}%`,
    ),
    '',
    'Defect classes:',
    ...summary.defects.map(
      (defect) => `  ${defect.severity.padEnd(7)} ${String(defect.count).padStart(3)}  ${defect.theme}`,
    ),
    '',
    'Automation tiers:',
    ...summary.tiers.map(
      (tier) => `  Tier ${tier.tier}  ${String(tier.count).padStart(4)} cases (${tier.percent}%)  ${tier.label}`,
    ),
    `  Reachable now: ${summary.automatableNow} (${summary.automatablePercent}%), automated today: ${summary.plan.currentlyAutomated}`,
    '',
    `Charts written:    ${slugs.length}`,
    ...slugs.map((slug) => `  reports/encryption/charts/${slug}.png`),
    '='.repeat(60),
    '',
  ];
  console.log(lines.join('\n'));
}
