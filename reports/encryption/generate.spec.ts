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

/**
 * Applicable (Pass or Fail) rows per workbook tab. The remainder of each tab's
 * 210 TC ids are unsupported combinations marked NA, plus - in the DNF tabs -
 * 70 unpopulated placeholder rows.
 */
const EXPECTED_IN_SCOPE: Record<string, number> = {
  'EO-Label': 162,
  'EO-Subject': 164,
  'EO-Options': 162,
  'DNF-Label': 112,
  'DNF-Subject': 108,
  'DNF-Default template': 108,
  'IC-Label': 162,
  'IC-Subject': 162,
};

const PLANNED_TC_IDS_PER_TAB = 210;

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
  const { inScope, pass, fail, passRate, plannedTcIds } = data.totals;

  expect(data.cases, 'one record per applicable case').toHaveLength(inScope);
  expect(pass + fail, 'every applicable case is a pass or a fail').toBe(inScope);
  expect(passRate, 'pass rate is computed over applicable cases').toBe(
    Math.round((pass / inScope) * 1000) / 10,
  );
  expect(
    data.cases.filter((entry) => entry.status !== 'Pass' && entry.status !== 'Fail'),
    'no not-applicable rows leak into scope',
  ).toHaveLength(0);

  for (const [category, expectedCount] of Object.entries(EXPECTED_IN_SCOPE)) {
    const meta = data.categories.find((entry) => entry.category === category);
    expect(meta, `${category} present`).toBeDefined();
    expect(meta?.inScope, `${category} applicable rows`).toBe(expectedCount);
    expect(meta?.plannedTcIds, `${category} planned TC ids`).toBe(PLANNED_TC_IDS_PER_TAB);
    expect((meta?.pass ?? 0) + (meta?.fail ?? 0), `${category} statuses sum to applicable`).toBe(
      expectedCount,
    );
    expect(
      (meta?.inScope ?? 0) + (meta?.excludedNotApplicable ?? 0) + (meta?.excludedPlaceholderRows ?? 0),
      `${category} scope plus exclusions equal its planned TC ids`,
    ).toBe(PLANNED_TC_IDS_PER_TAB);
    expect(
      data.cases.filter((entry) => entry.category === category),
      `${category} case records`,
    ).toHaveLength(expectedCount);
  }

  // Scope plus documented exclusions must still account for the planned matrix.
  expect(
    inScope + data.scope.excludedNotApplicable + data.scope.excludedPlaceholderRows,
    'scope plus exclusions equal the planned TC ids',
  ).toBe(plannedTcIds);
  expect(plannedTcIds, 'planned matrix is 8 tabs of 210 ids').toBe(
    Object.keys(EXPECTED_IN_SCOPE).length * PLANNED_TC_IDS_PER_TAB,
  );

  // Per-template aggregates used by the trajectory chart.
  for (const [template, meta] of Object.entries(data.byTemplate)) {
    const cases = data.cases.filter((entry) => entry.template === template);
    expect(cases, `${template} case records`).toHaveLength(meta.inScope);
    expect(cases.filter((entry) => entry.status === 'Pass'), `${template} pass`).toHaveLength(meta.pass);
    expect(Math.round((meta.pass / meta.inScope) * 1000) / 10, `${template} pass rate`).toBe(
      meta.passRate,
    );
  }
  expect(
    Object.values(data.byTemplate).reduce((sum, meta) => sum + meta.inScope, 0),
    'templates cover every applicable case',
  ).toBe(inScope);

  // Per-category pass rates must match what the category metadata claims.
  for (const meta of data.categories) {
    const cases = data.cases.filter((entry) => entry.category === meta.category);
    expect(cases.filter((entry) => entry.status === 'Pass'), `${meta.category} pass`).toHaveLength(meta.pass);
    expect(cases.filter((entry) => entry.status === 'Fail'), `${meta.category} fail`).toHaveLength(meta.fail);
    expect(Math.round((meta.pass / meta.inScope) * 1000) / 10, `${meta.category} pass rate`).toBe(
      meta.passRate,
    );
  }

  expect(
    summary.tiers.reduce((sum, tier) => sum + tier.count, 0),
    'automation tiers cover every applicable case',
  ).toBe(inScope);
  expect(
    summary.defects.reduce((sum, defect) => sum + defect.count, 0),
    'defect classes cover every failure',
  ).toBe(fail);

  const week0 = history.weeks[0];
  expect(week0, 'baseline cycle present').toBeDefined();
  expect(week0?.pass, 'baseline pass matches the sheet').toBe(pass);
  expect(week0?.fail, 'baseline fail matches the sheet').toBe(fail);
  expect(week0?.passRate, 'baseline pass rate matches the sheet').toBe(passRate);
  expect(week0?.inScope, 'baseline scope matches the sheet').toBe(inScope);
  expect(week0?.openDefectClasses, 'baseline defect classes match').toBe(summary.defects.length);
  for (const meta of data.categories) {
    expect(week0?.byCategory[meta.category], `${meta.category} baseline pass rate`).toBe(meta.passRate);
  }
  for (const [template, meta] of Object.entries(data.byTemplate)) {
    expect(week0?.byTemplate[template], `${template} baseline pass rate`).toBe(meta.passRate);
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
    `${summary.totals.inScope.toLocaleString()} applicable`,
    `${summary.totals.pass.toLocaleString()} pass`,
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
    `Applicable cases:  ${summary.totals.inScope}`,
    `Pass / Fail:       ${summary.totals.pass} / ${summary.totals.fail}`,
    `Pass rate:         ${summary.totals.passRate.toFixed(1)}%`,
    `Excluded:          ${summary.scope.excludedNotApplicable} not applicable, ${summary.scope.excludedPlaceholderRows} placeholder rows`,
    '',
    'Categories (worst first):',
    ...summary.categories.map(
      (category) =>
        `  ${category.category.padEnd(22)} ${String(category.inScope).padStart(4)} cases  ${category.passRate.toFixed(1).padStart(5)}%`,
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
