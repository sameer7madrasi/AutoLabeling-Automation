/**
 * Chart builders for the Encryption test-suite report.
 *
 * Every figure comes from reports/encryption/data/*.json. The generator asserts
 * the aggregates reconcile with the workbook before rendering, so the email
 * narrative cannot drift from the sheet.
 */

import { COLORS, legend, line, rect, reportPageStyles, svgOpen, text } from '../lib/svg';

export interface EncryptionCase {
  tcId: number;
  category: string;
  template: string;
  trigger: string;
  action: string;
  clientPair: string;
  tenantPair: string;
  status: string;
  defectTheme: string;
  automationTier: string;
}

export interface CategoryMeta {
  category: string;
  template: string;
  trigger: string;
  plannedTcIds: number;
  populated: number;
  blankStatusRows: number;
  pass: number;
  fail: number;
  notApplicable: number;
  executed: number;
  passRate: number;
}

export interface EncryptionData {
  source: string;
  extractedAt: string;
  cycle: string;
  placeholderRows: { count: number; tabs: string[]; detail: string };
  dimensions: {
    templates: string[];
    triggers: string[];
    clientPairs: string[];
    tenantPairs: string[];
    recipientGroups: Record<string, string[]>;
  };
  totals: {
    populated: number;
    pass: number;
    fail: number;
    notApplicable: number;
    executed: number;
    passRate: number;
  };
  categories: CategoryMeta[];
  cases: EncryptionCase[];
}

export interface WeekEntry {
  week: number;
  label: string;
  cycleEnding: string;
  populated: number;
  executed: number;
  pass: number;
  fail: number;
  notApplicable: number;
  passRate: number;
  coverage: number;
  automatedCases: number;
  openDefectClasses: number;
  byCategory: Record<string, number>;
  note: string;
}

export interface WeeklyHistory {
  howToUpdate: string;
  placeholderWeeks: number;
  weeks: WeekEntry[];
}

export interface TierMeta {
  label: string;
  surface: string;
  verdict: string;
  currentStatus: string;
  assertions?: string[];
  staysManual?: string;
  notes?: string;
}

export interface AutomationPlan {
  currentlyAutomated: number;
  reusedFrom: string;
  scopeDecision: string;
  tiers: Record<string, TierMeta>;
  phases: { id: number; name: string; work: string; unlocks: string }[];
  risks: string[];
}

export interface DefectSummary {
  theme: string;
  count: number;
  severity: 'High' | 'Medium' | 'Low';
  where: string;
}

export interface TierSummary {
  tier: string;
  label: string;
  surface: string;
  count: number;
  percent: number;
}

export interface EncryptionSummary {
  totals: EncryptionData['totals'];
  placeholderRows: EncryptionData['placeholderRows'];
  categories: CategoryMeta[];
  defects: DefectSummary[];
  tiers: TierSummary[];
  automatableNow: number;
  automatablePercent: number;
  history: WeeklyHistory;
  plan: AutomationPlan;
}

/**
 * Severity is our judgement, not a field in the sheet: a Do Not Forward
 * template that still allows forwarding is a failed security control, whereas
 * the consumer-mail issues are interop defects in attachment handling.
 */
const SEVERITY: Record<string, DefectSummary['severity']> = {
  'DNF forward not blocked': 'High',
  'OME wrapper missing': 'High',
  'Gmail attachment preview and filename': 'Medium',
  'Yahoo PDF filename': 'Medium',
  'Attachment preview (xlsx)': 'Low',
};

function recipientOf(tenantPair: string): string {
  return tenantPair.split(' to ')[1] ?? tenantPair;
}

function shortClient(clientPair: string): string {
  return clientPair.replace(/WODC Old\(Classic\)/g, 'WODC Classic').replace(/ TO | to /g, ' -> ');
}

export function buildSummary(
  data: EncryptionData,
  history: WeeklyHistory,
  plan: AutomationPlan,
): EncryptionSummary {
  const failures = data.cases.filter((c) => c.status === 'Fail');
  const themes = Array.from(new Set(failures.map((c) => c.defectTheme)));

  const defects: DefectSummary[] = themes
    .map((theme) => {
      const hits = failures.filter((c) => c.defectTheme === theme);
      const recipients = Array.from(new Set(hits.map((c) => recipientOf(c.tenantPair)))).sort();
      const clientPairs = Array.from(new Set(hits.map((c) => c.clientPair)));
      const templates = Array.from(new Set(hits.map((c) => c.template)));
      const clientLabel =
        clientPairs.length <= 2
          ? clientPairs.map(shortClient).join(', ')
          : `${clientPairs.length} client pairs`;
      return {
        theme,
        count: hits.length,
        severity: SEVERITY[theme] ?? 'Medium',
        where: `${recipients.join(' / ')} recipients | ${clientLabel} | ${templates.length === 3 ? 'all templates' : templates.join(', ')}`,
      };
    })
    .sort((a, b) => b.count - a.count);

  const tiers: TierSummary[] = Object.entries(plan.tiers).map(([key, meta]) => {
    const count = data.cases.filter((c) => c.automationTier === key).length;
    return {
      tier: key,
      label: meta.label,
      surface: meta.surface,
      count,
      percent: Math.round((count / data.totals.populated) * 1000) / 10,
    };
  });

  const automatableNow = tiers
    .filter((tier) => tier.tier !== 'C')
    .reduce((sum, tier) => sum + tier.count, 0);

  return {
    totals: data.totals,
    placeholderRows: data.placeholderRows,
    categories: [...data.categories].sort((a, b) => a.passRate - b.passRate),
    defects,
    tiers,
    automatableNow,
    automatablePercent: Math.round((automatableNow / data.totals.populated) * 1000) / 10,
    history,
    plan,
  };
}

// --- Chart 1: execution status (fixes the mixed-denominator pie) -------------

function donutSlice(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startFraction: number,
  endFraction: number,
  fill: string,
): string {
  const toXY = (fraction: number, radius: number) => {
    const angle = (fraction * 360 - 90) * (Math.PI / 180);
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };
  const [x1, y1] = toXY(startFraction, rOuter);
  const [x2, y2] = toXY(endFraction, rOuter);
  const [x3, y3] = toXY(endFraction, rInner);
  const [x4, y4] = toXY(startFraction, rInner);
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
  return [
    `<path d="M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z"`,
    `fill="${fill}" stroke="#ffffff" stroke-width="2" />`,
  ].join(' ');
}

export function renderExecutionStatusChart(summary: EncryptionSummary): string {
  const width = 650;
  const height = 300;
  const { populated, pass, fail, notApplicable, executed, passRate } = summary.totals;
  const slices = [
    { label: 'Pass', value: pass, color: COLORS.pass },
    { label: 'Fail', value: fail, color: COLORS.fail },
    { label: 'Not applicable', value: notApplicable, color: COLORS.notApplicable },
  ];

  const cx = 148;
  const cy = 168;
  let cursor = 0;
  const arcs = slices
    .map((slice) => {
      const start = cursor;
      cursor += slice.value / populated;
      return donutSlice(cx, cy, 92, 54, start, cursor, slice.color);
    })
    .join('');

  const rows = slices
    .map((slice, index) => {
      const y = 126 + index * 34;
      const percent = ((slice.value / populated) * 100).toFixed(1);
      return [
        rect(292, y - 11, 12, 12, slice.color, 2),
        text(312, y, slice.label, { size: 12.5, weight: 600 }),
        text(width, y, `${slice.value.toLocaleString()}  (${percent}%)`, {
          size: 12.5,
          weight: 600,
          anchor: 'end',
          fill: COLORS.muted,
        }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Execution status - all figures over the same 1,470 cases', { size: 15, weight: 600 }),
    text(0, 38, `${executed.toLocaleString()} cases executed, ${notApplicable} not applicable by design`, {
      size: 11.5,
      fill: COLORS.muted,
    }),
    arcs,
    text(cx, cy - 4, `${populated.toLocaleString()}`, { size: 25, weight: 700, anchor: 'middle' }),
    text(cx, cy + 15, 'test cases', { size: 11.5, fill: COLORS.muted, anchor: 'middle' }),
    rows,
    line(292, 236, width, 236, COLORS.grid, { width: 1 }),
    text(292, 258, 'Pass rate on executed cases', { size: 12.5, weight: 600 }),
    text(width, 258, `${passRate.toFixed(1)}%`, { size: 15, weight: 700, anchor: 'end', fill: COLORS.pass }),
    text(292, 276, `${pass.toLocaleString()} of ${executed.toLocaleString()} executed`, {
      size: 11,
      fill: COLORS.muted,
    }),
    text(0, 292, `Excludes ${summary.placeholderRows.count} unpopulated placeholder rows in the DNF tabs (TC 141-210).`, {
      size: 10.5,
      fill: COLORS.muted,
    }),
    '</svg>',
  ].join('');
}

// --- Chart 2: status by category --------------------------------------------

export function renderCategoryChart(summary: EncryptionSummary): string {
  const width = 650;
  const rowHeight = 25;
  const gap = 8;
  const top = 74;
  const height = top + summary.categories.length * (rowHeight + gap) + 18;
  const barX = 168;
  const maxPopulated = Math.max(...summary.categories.map((c) => c.populated));
  const unit = 330 / maxPopulated;

  const rows = summary.categories
    .map((category, index) => {
      const y = top + index * (rowHeight + gap);
      let cursor = barX;
      const bars = [
        { value: category.pass, color: COLORS.pass },
        { value: category.fail, color: COLORS.fail },
        { value: category.notApplicable, color: COLORS.notApplicable },
      ]
        .map((segment) => {
          if (segment.value === 0) return '';
          const w = segment.value * unit;
          const block = [
            rect(cursor, y, w, rowHeight, segment.color, 2),
            w > 22
              ? text(cursor + w / 2, y + 17, String(segment.value), {
                  size: 11.5,
                  weight: 600,
                  fill: '#ffffff',
                  anchor: 'middle',
                })
              : '',
          ].join('');
          cursor += w + 2;
          return block;
        })
        .join('');
      return [
        text(barX - 10, y + 17, category.category, { size: 12, anchor: 'end' }),
        bars,
        text(width, y + 17, `${category.passRate.toFixed(1)}%`, {
          size: 12,
          weight: 700,
          anchor: 'end',
          fill: category.passRate >= 90 ? COLORS.pass : COLORS.ink,
        }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Status by protection category', { size: 15, weight: 600 }),
    text(0, 38, 'Sorted worst-first. Do Not Forward trails; Internal Confidential is near clean', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    legend(0, 58, [
      { color: COLORS.pass, label: 'Pass' },
      { color: COLORS.fail, label: 'Fail' },
      { color: COLORS.notApplicable, label: 'Not applicable' },
    ]),
    text(width, 58, 'pass rate', { size: 10.5, fill: COLORS.muted, anchor: 'end' }),
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 3: trajectory ----------------------------------------------------

export function renderTrajectoryChart(summary: EncryptionSummary): string {
  const width = 650;
  const height = 290;
  const left = 44;
  const right = width - 118;
  const baseline = 222;
  const topY = 74;
  const weeks = summary.history.weeks;
  const columns = weeks.length + summary.history.placeholderWeeks;
  const stepX = (right - left) / Math.max(columns - 1, 1);
  const pointX = (index: number) => left + index * stepX;
  const scaleY = (percent: number) => baseline - (percent / 100) * (baseline - topY);

  const gridLines = [0, 25, 50, 75, 100]
    .map((tick) =>
      [
        line(left, scaleY(tick), right, scaleY(tick), COLORS.grid, { width: 1 }),
        text(left - 8, scaleY(tick) + 4, `${tick}%`, { size: 10.5, fill: COLORS.muted, anchor: 'end' }),
      ].join(''),
    )
    .join('');

  const series = [
    { key: 'passRate' as const, color: COLORS.pass, label: 'Pass rate (executed)' },
    { key: 'coverage' as const, color: COLORS.accent, label: 'Execution coverage' },
  ];

  const plotted = series
    .map((serie) => {
      const path = weeks
        .map((week, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index)} ${scaleY(week[serie.key])}`)
        .join(' ');
      const dots = weeks
        .map(
          (week, index) =>
            `<circle cx="${pointX(index)}" cy="${scaleY(week[serie.key])}" r="5" fill="${serie.color}" stroke="#ffffff" stroke-width="1.5" />`,
        )
        .join('');
      return `${weeks.length > 1 ? `<path d="${path}" fill="none" stroke="${serie.color}" stroke-width="2.5" />` : ''}${dots}`;
    })
    .join('');

  // Future cycles are drawn as empty slots so the chart visibly fills up.
  const futureColumns = Array.from({ length: columns - weeks.length }, (_, offset) => {
    const index = weeks.length + offset;
    return [
      line(pointX(index), topY, pointX(index), baseline, COLORS.grid, { width: 1, dash: '3 4' }),
      text(pointX(index), baseline + 18, `W${(weeks.at(-1)?.week ?? 0) + offset + 1}`, {
        size: 10.5,
        fill: COLORS.muted,
        anchor: 'middle',
      }),
    ].join('');
  }).join('');

  const pastColumns = weeks
    .map((week, index) =>
      text(pointX(index), baseline + 18, week.label, {
        size: 11,
        weight: 600,
        anchor: 'middle',
      }),
    )
    .join('');

  const latest = weeks.at(-1);
  const latestIndex = weeks.length - 1;

  // With a single baseline cycle the two values sit ~8px apart, so the readouts
  // are placed beside the column at fixed offsets rather than above each dot.
  const readouts = latest
    ? [
        text(pointX(latestIndex) + 14, scaleY(latest.passRate) - 8, `${latest.passRate.toFixed(1)}% pass rate`, {
          size: 12,
          weight: 700,
          fill: COLORS.pass,
        }),
        text(
          pointX(latestIndex) + 14,
          scaleY(latest.passRate) + 8,
          `${latest.pass.toLocaleString()} of ${latest.executed.toLocaleString()} executed`,
          { size: 10.5, fill: COLORS.muted },
        ),
        text(pointX(latestIndex) + 14, scaleY(latest.coverage) + 30, `${latest.coverage.toFixed(1)}% coverage`, {
          size: 12,
          weight: 700,
          fill: COLORS.accent,
        }),
        text(
          pointX(latestIndex) + 14,
          scaleY(latest.coverage) + 46,
          `${latest.executed.toLocaleString()} of ${latest.populated.toLocaleString()} populated`,
          { size: 10.5, fill: COLORS.muted },
        ),
      ].join('')
    : '';

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Trajectory: pass rate and execution coverage by cycle', { size: 15, weight: 600 }),
    text(0, 38, `${latest?.label ?? 'W0'} is the baseline; each cycle appends one point, so the trend builds from here`, {
      size: 11.5,
      fill: COLORS.muted,
    }),
    legend(0, 58, series.map((serie) => ({ color: serie.color, label: serie.label }))),
    gridLines,
    line(left, baseline, right, baseline, COLORS.muted, { width: 1 }),
    futureColumns,
    plotted,
    pastColumns,
    readouts,
    text(0, height - 6, 'Coverage = executed cases divided by populated cases. Awaiting the next cycle to extend both lines.', {
      size: 10.5,
      fill: COLORS.muted,
    }),
    '</svg>',
  ].join('');
}

// --- Chart 4: per-feature weekly tracker ------------------------------------

function passRateColor(passRate: number): { fill: string; ink: string } {
  if (passRate >= 95) return { fill: COLORS.pass, ink: '#ffffff' };
  if (passRate >= 85) return { fill: COLORS.tier1, ink: '#ffffff' };
  if (passRate >= 75) return { fill: COLORS.tbc, ink: COLORS.ink };
  return { fill: '#d13438', ink: '#ffffff' };
}

export function renderFeatureTrackerChart(summary: EncryptionSummary): string {
  const width = 650;
  const rowHeight = 26;
  const gap = 6;
  const top = 82;
  const categories = summary.categories;
  const height = top + categories.length * (rowHeight + gap) + 34;
  const labelWidth = 170;
  const weeks = summary.history.weeks;
  const columns = weeks.length + summary.history.placeholderWeeks;
  const cellWidth = (width - labelWidth) / columns - 6;

  const headers = Array.from({ length: columns }, (_, index) => {
    const week = weeks[index];
    const label = week ? week.label : `W${(weeks.at(-1)?.week ?? 0) + (index - weeks.length) + 1}`;
    const x = labelWidth + index * (cellWidth + 6) + cellWidth / 2;
    return text(x, top - 10, label, {
      size: 11,
      weight: week ? 700 : 400,
      fill: week ? COLORS.ink : COLORS.muted,
      anchor: 'middle',
    });
  }).join('');

  const rows = categories
    .map((category, rowIndex) => {
      const y = top + rowIndex * (rowHeight + gap);
      const cells = Array.from({ length: columns }, (_, index) => {
        const x = labelWidth + index * (cellWidth + 6);
        const week = weeks[index];
        const value = week?.byCategory[category.category];
        if (value === undefined) {
          return `<rect x="${x}" y="${y}" width="${cellWidth}" height="${rowHeight}" rx="3" fill="#ffffff" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="3 3" />`;
        }
        const tone = passRateColor(value);
        return [
          rect(x, y, cellWidth, rowHeight, tone.fill, 3),
          text(x + cellWidth / 2, y + 17.5, `${value.toFixed(1)}%`, {
            size: 11.5,
            weight: 700,
            fill: tone.ink,
            anchor: 'middle',
          }),
        ].join('');
      }).join('');
      return [
        text(labelWidth - 12, y + 17.5, category.category, { size: 12, anchor: 'end' }),
        cells,
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Per-feature tracker: pass rate by cycle', { size: 15, weight: 600 }),
    text(0, 38, 'Dashed cells are future cycles. Each execution pass fills one more column', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    legend(0, 58, [
      { color: COLORS.pass, label: '95%+' },
      { color: COLORS.tier1, label: '85-94%' },
      { color: COLORS.tbc, label: '75-84%' },
      { color: '#d13438', label: 'below 75%' },
    ]),
    headers,
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 5: defect concentration ------------------------------------------

export function renderDefectChart(summary: EncryptionSummary): string {
  const width = 650;
  const blockHeight = 46;
  const top = 66;
  const height = top + summary.defects.length * blockHeight + 26;
  const barX = 336;
  const barMax = 218;
  const maxCount = Math.max(...summary.defects.map((defect) => defect.count));
  const severityColor: Record<DefectSummary['severity'], string> = {
    High: '#c50f1f',
    Medium: COLORS.tbc,
    Low: COLORS.notApplicable,
  };

  const rows = summary.defects
    .map((defect, index) => {
      const y = top + index * blockHeight;
      const w = (defect.count / maxCount) * barMax;
      return [
        // Severity pill in its own left column so long defect names cannot collide with it.
        rect(0, y + 2, 52, 18, severityColor[defect.severity], 9),
        text(26, y + 15, defect.severity, { size: 10, weight: 700, fill: '#ffffff', anchor: 'middle' }),
        text(62, y + 15, defect.theme, { size: 12, weight: 600 }),
        text(62, y + 31, defect.where, { size: 10, fill: COLORS.muted }),
        rect(barX, y + 2, w, 18, severityColor[defect.severity], 2),
        text(barX + w + 8, y + 15, `${defect.count} cases`, { size: 11.5, weight: 600, fill: COLORS.muted }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, `${summary.totals.fail} failures trace back to ${summary.defects.length} defect classes`, {
      size: 15,
      weight: 600,
    }),
    text(0, 38, 'The two consumer-mail issues account for most of the volume; the Do Not Forward gap is the severity risk', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 6: automation viability ------------------------------------------

export function renderAutomationChart(summary: EncryptionSummary): string {
  const width = 650;
  const barY = 78;
  const barHeight = 40;
  const height = barY + barHeight + 40 + summary.tiers.length * 34;
  const tierColor: Record<string, string> = { A: COLORS.tier1, B: COLORS.tier2, C: COLORS.tier4 };

  let cursor = 0;
  const bar = summary.tiers
    .map((tier) => {
      const w = (tier.count / summary.totals.populated) * width;
      const block = [
        rect(cursor, barY, w - 2, barHeight, tierColor[tier.tier] ?? COLORS.tier4, 3),
        w > 46
          ? text(cursor + (w - 2) / 2, barY + 25, `${tier.count.toLocaleString()}`, {
              size: 13,
              weight: 700,
              fill: '#ffffff',
              anchor: 'middle',
            })
          : text(cursor + (w - 2) / 2, barY - 7, String(tier.count), {
              size: 11.5,
              weight: 700,
              fill: tierColor[tier.tier] ?? COLORS.tier4,
              anchor: 'middle',
            }),
      ].join('');
      cursor += w;
      return block;
    })
    .join('');

  const rows = summary.tiers
    .map((tier, index) => {
      const y = barY + barHeight + 38 + index * 34;
      return [
        rect(0, y - 10, 11, 11, tierColor[tier.tier] ?? COLORS.tier4, 2),
        text(19, y, `Tier ${tier.tier} - ${tier.label}: ${tier.count.toLocaleString()} cases (${tier.percent}%)`, {
          size: 12,
          weight: 600,
        }),
        text(19, y + 14, tier.surface, { size: 11, fill: COLORS.muted }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Automation viability of the 1,470 cases', { size: 15, weight: 600 }),
    text(0, 38, `${summary.automatableNow} cases (${summary.automatablePercent}%) are reachable with web plus IMAP automation; ${summary.plan.currentlyAutomated} automated today`, {
      size: 11.5,
      fill: COLORS.muted,
    }),
    text(0, 56, 'Tiers describe the client surface a case needs, which is what drives cost', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    bar,
    rows,
    '</svg>',
  ].join('');
}

// --- Page -------------------------------------------------------------------

export interface ChartSpec {
  slug: string;
  title: string;
  svg: string;
}

export function buildCharts(summary: EncryptionSummary): ChartSpec[] {
  return [
    { slug: '01-execution-status', title: 'Execution status', svg: renderExecutionStatusChart(summary) },
    { slug: '02-status-by-category', title: 'Status by category', svg: renderCategoryChart(summary) },
    { slug: '03-trajectory', title: 'Trajectory', svg: renderTrajectoryChart(summary) },
    { slug: '04-feature-tracker', title: 'Per-feature tracker', svg: renderFeatureTrackerChart(summary) },
    { slug: '05-defect-concentration', title: 'Defect concentration', svg: renderDefectChart(summary) },
    { slug: '06-automation-viability', title: 'Automation viability', svg: renderAutomationChart(summary) },
  ];
}

export function renderReportHtml(
  summary: EncryptionSummary,
  charts: ChartSpec[],
  generatedAt: string,
): string {
  const categoryRows = summary.categories
    .map(
      (category) =>
        `<tr><td>${category.category}</td><td>${category.populated}</td><td>${category.pass}</td><td>${category.fail}</td><td>${category.notApplicable}</td><td><strong>${category.passRate.toFixed(1)}%</strong></td></tr>`,
    )
    .join('');
  const defectRows = summary.defects
    .map(
      (defect) =>
        `<tr><td>${defect.theme}</td><td>${defect.severity}</td><td>${defect.count}</td><td>${defect.where}</td></tr>`,
    )
    .join('');
  const phaseRows = summary.plan.phases
    .map(
      (phase) =>
        `<tr><td>Phase ${phase.id}</td><td>${phase.name}</td><td>${phase.work}</td><td>${phase.unlocks}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Encryption test suite - execution report</title>
<style>${reportPageStyles()}</style>
</head>
<body>
<main>
  <h1>Encryption test suite: execution status and automation plan</h1>
  <p class="lede">${summary.totals.populated.toLocaleString()} populated cases &middot; ${summary.totals.executed.toLocaleString()} executed &middot; ${summary.totals.passRate.toFixed(1)}% pass rate &middot; ${summary.defects.length} open defect classes &middot; generated ${generatedAt}</p>
  ${charts.map((chart) => `<div class="chart" data-chart="${chart.slug}">${chart.svg}</div>`).join('\n  ')}
  <h2>Category detail</h2>
  <table>
    <thead><tr><th>Category</th><th>Cases</th><th>Pass</th><th>Fail</th><th>N/A</th><th>Pass rate</th></tr></thead>
    <tbody>${categoryRows}</tbody>
  </table>
  <h2>Defect classes</h2>
  <table>
    <thead><tr><th>Defect</th><th>Severity</th><th>Cases</th><th>Where it appears</th></tr></thead>
    <tbody>${defectRows}</tbody>
  </table>
  <h2>Automation phases</h2>
  <table>
    <thead><tr><th>Phase</th><th>Name</th><th>Work</th><th>Unlocks</th></tr></thead>
    <tbody>${phaseRows}</tbody>
  </table>
  <h2>Note on test-case counts</h2>
  <p class="lede">${summary.placeholderRows.detail}</p>
</main>
</body>
</html>`;
}
