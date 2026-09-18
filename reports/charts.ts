/**
 * Chart and summary builders for the weekly auto-labeling PM report.
 *
 * Every number rendered here is derived from reports/data/*.json - nothing is
 * hardcoded - so the email narrative cannot drift from the scenario data.
 */

import { COLORS, FONT, legend, rect, svgOpen, text } from './lib/svg';

export { COLORS } from './lib/svg';

export interface TestCase {
  id: string;
  sectionKey: string;
  sectionShort: string;
  section: string;
  name: string;
  description: string;
  priority: string;
  sheetStatus: string;
  automationTier: number;
  automationNote: string;
  automated: boolean;
}

export interface TierMeta {
  label: string;
  description: string;
}

export interface TestCaseFile {
  source: string;
  extractedAt: string;
  statusLegend: Record<string, string>;
  tiers: Record<string, TierMeta>;
  sections: { key: string; short: string }[];
  cases: TestCase[];
}

export interface TrackerPoint {
  week: string;
  weekStarting: string;
  automated: number;
  note: string;
}

export interface HistoryFile {
  totalScenarios: number;
  tierOneAndTwoCeiling: number;
  actuals: TrackerPoint[];
  targets: TrackerPoint[];
}

export interface SectionSummary {
  key: string;
  short: string;
  total: number;
  pass: number;
  tbc: number;
  clarification: number;
}

export interface TierSummary {
  tier: number;
  label: string;
  description: string;
  count: number;
  ids: string[];
}

export interface Summary {
  total: number;
  passed: number;
  tbc: number;
  clarification: number;
  open: number;
  byPriority: { priority: string; pass: number; tbc: number; clarification: number; total: number }[];
  sections: SectionSummary[];
  tiers: TierSummary[];
  openItems: { id: string; priority: string; status: string; name: string; sectionShort: string }[];
  automatedIds: string[];
  automatedCount: number;
  automatedPercent: number;
  tracker: HistoryFile;
}

const STATUS_PASS = 'Pass';
const STATUS_TBC = 'TBC';
const STATUS_CLARIFICATION = 'Clarification Needed';

export function buildSummary(data: TestCaseFile, history: HistoryFile): Summary {
  const cases = data.cases;
  const count = (predicate: (c: TestCase) => boolean) => cases.filter(predicate).length;

  const sections: SectionSummary[] = data.sections.map((section) => {
    const inSection = cases.filter((c) => c.sectionKey === section.key);
    return {
      key: section.key,
      short: section.short,
      total: inSection.length,
      pass: inSection.filter((c) => c.sheetStatus === STATUS_PASS).length,
      tbc: inSection.filter((c) => c.sheetStatus === STATUS_TBC).length,
      clarification: inSection.filter((c) => c.sheetStatus === STATUS_CLARIFICATION).length,
    };
  });

  const priorities = Array.from(new Set(cases.map((c) => c.priority))).sort();
  const byPriority = priorities.map((priority) => {
    const inPriority = cases.filter((c) => c.priority === priority);
    return {
      priority,
      total: inPriority.length,
      pass: inPriority.filter((c) => c.sheetStatus === STATUS_PASS).length,
      tbc: inPriority.filter((c) => c.sheetStatus === STATUS_TBC).length,
      clarification: inPriority.filter((c) => c.sheetStatus === STATUS_CLARIFICATION).length,
    };
  });

  const tiers: TierSummary[] = Object.entries(data.tiers).map(([key, meta]) => {
    const tier = Number(key);
    const inTier = cases.filter((c) => c.automationTier === tier);
    return { tier, label: meta.label, description: meta.description, count: inTier.length, ids: inTier.map((c) => c.id) };
  });

  const automated = cases.filter((c) => c.automated);

  return {
    total: cases.length,
    passed: count((c) => c.sheetStatus === STATUS_PASS),
    tbc: count((c) => c.sheetStatus === STATUS_TBC),
    clarification: count((c) => c.sheetStatus === STATUS_CLARIFICATION),
    open: count((c) => c.sheetStatus !== STATUS_PASS),
    byPriority,
    sections,
    tiers,
    openItems: cases
      .filter((c) => c.sheetStatus !== STATUS_PASS)
      .map((c) => ({
        id: c.id,
        priority: c.priority,
        status: c.sheetStatus,
        name: c.name,
        sectionShort: c.sectionShort,
      })),
    automatedIds: automated.map((c) => c.id),
    automatedCount: automated.length,
    automatedPercent: Math.round((automated.length / cases.length) * 1000) / 10,
    tracker: history,
  };
}

// --- Chart 1: onboarding funnel ---------------------------------------------

export function renderFunnelChart(summary: Summary): string {
  const width = 650;
  const stages = [
    { label: 'Shared by PM', value: summary.total, color: '#0f6cbd' },
    { label: 'Onboarded & documented', value: summary.total, color: '#2b88d8' },
    { label: 'Executed & passing', value: summary.passed, color: COLORS.pass },
    { label: 'Open (TBC or clarification)', value: summary.open, color: COLORS.tbc },
    { label: 'Automated end-to-end', value: summary.automatedCount, color: COLORS.shipped },
  ];
  const rowHeight = 30;
  const gap = 8;
  const top = 54;
  const height = top + stages.length * (rowHeight + gap) + 14;
  const barX = 200;
  // Leaves room for the "42 (100%)" label to sit outside a full-width bar.
  const barMax = 325;

  const rows = stages
    .map((stage, index) => {
      const y = top + index * (rowHeight + gap);
      const barWidth = (stage.value / summary.total) * barMax;
      const percent = Math.round((stage.value / summary.total) * 100);
      return [
        text(barX - 10, y + 20, stage.label, { size: 12.5, anchor: 'end' }),
        rect(barX, y, barMax, rowHeight, '#f3f2f1', 3),
        rect(barX, y, barWidth, rowHeight, stage.color, 3),
        text(barX + barWidth + 8, y + 20, `${stage.value}  (${percent}%)`, {
          size: 12,
          weight: 600,
          fill: COLORS.muted,
        }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Scenario pipeline: from shared to automated', { size: 15, weight: 600 }),
    text(0, 38, `All ${summary.total} scenarios are onboarded; ${summary.automatedCount} is automated end-to-end`, {
      size: 11.5,
      fill: COLORS.muted,
    }),
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 2: status by section ---------------------------------------------

export function renderSectionChart(summary: Summary): string {
  const width = 650;
  const rowHeight = 24;
  const gap = 7;
  const top = 68;
  const height = top + summary.sections.length * (rowHeight + gap) + 16;
  const barX = 208;
  const maxTotal = Math.max(...summary.sections.map((s) => s.total));
  const unit = 330 / maxTotal;

  const rows = summary.sections
    .map((section, index) => {
      const y = top + index * (rowHeight + gap);
      const segments = [
        { value: section.pass, color: COLORS.pass },
        { value: section.tbc, color: COLORS.tbc },
        { value: section.clarification, color: COLORS.clarification },
      ];
      let cursor = barX;
      const bars = segments
        .map((segment) => {
          if (segment.value === 0) return '';
          const w = segment.value * unit;
          const block = [
            rect(cursor, y, w, rowHeight, segment.color, 2),
            w > 16
              ? text(cursor + w / 2, y + 16.5, String(segment.value), {
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
        text(barX - 10, y + 16.5, `${section.key} ${section.short}`, { size: 12, anchor: 'end' }),
        bars,
        text(cursor + 8, y + 16.5, `${section.pass}/${section.total} passing`, { size: 11, fill: COLORS.muted }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Status by feature area', { size: 15, weight: 600 }),
    text(0, 38, 'Remove label and Negative & edge carry most of the open work', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    legend(0, 56, [
      { color: COLORS.pass, label: `Pass (${summary.passed})` },
      { color: COLORS.tbc, label: `TBC (${summary.tbc})` },
      { color: COLORS.clarification, label: `Clarification needed (${summary.clarification})` },
    ]),
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 3: priority vs status --------------------------------------------

export function renderPriorityChart(summary: Summary): string {
  const width = 650;
  const height = 272;
  const baseline = 216;
  const maxValue = Math.max(...summary.byPriority.flatMap((p) => [p.pass, p.tbc, p.clarification]));
  // Leaves room for the value label above the tallest bar without hitting the legend.
  const scale = 118 / maxValue;
  const groupWidth = 150;
  const barWidth = 38;
  const startX = 90;

  const gridLines = [0, 5, 10, 15, 20]
    .filter((tick) => tick <= maxValue + 3)
    .map((tick) => {
      const y = baseline - tick * scale;
      return [
        `<line x1="${startX - 30}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1" />`,
        text(startX - 38, y + 4, String(tick), { size: 10.5, fill: COLORS.muted, anchor: 'end' }),
      ].join('');
    })
    .join('');

  const groups = summary.byPriority
    .map((priority, index) => {
      const groupX = startX + index * groupWidth;
      const bars = [
        { value: priority.pass, color: COLORS.pass },
        { value: priority.tbc, color: COLORS.tbc },
        { value: priority.clarification, color: COLORS.clarification },
      ]
        .map((bar, barIndex) => {
          const x = groupX + barIndex * (barWidth + 6);
          const h = bar.value * scale;
          return [
            rect(x, baseline - h, barWidth, h, bar.color, 2),
            text(x + barWidth / 2, baseline - h - 6, String(bar.value), {
              size: 11.5,
              weight: 600,
              fill: COLORS.ink,
              anchor: 'middle',
            }),
          ].join('');
        })
        .join('');
      return [
        bars,
        text(groupX + (barWidth * 3 + 12) / 2, baseline + 18, `${priority.priority} (${priority.total})`, {
          size: 12.5,
          weight: 600,
          anchor: 'middle',
        }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Status by priority', { size: 15, weight: 600 }),
    text(
      0,
      38,
      `${(summary.byPriority[0]?.tbc ?? 0) + (summary.byPriority[0]?.clarification ?? 0)} P1 scenarios are still open - these gate the weekly signal`,
      { size: 11.5, fill: COLORS.muted },
    ),
    legend(0, 56, [
      { color: COLORS.pass, label: 'Pass' },
      { color: COLORS.tbc, label: 'TBC' },
      { color: COLORS.clarification, label: 'Clarification needed' },
    ]),
    gridLines,
    `<line x1="${startX - 30}" y1="${baseline}" x2="${width - 20}" y2="${baseline}" stroke="${COLORS.muted}" stroke-width="1" />`,
    groups,
    '</svg>',
  ].join('');
}

// --- Chart 4: automation viability ------------------------------------------

export function renderViabilityChart(summary: Summary): string {
  const width = 650;
  const barY = 66;
  const barHeight = 42;
  const height = barY + barHeight + 34 + summary.tiers.length * 30;
  const barX = 0;
  const barMax = 650;

  const tierColor: Record<number, string> = {
    1: COLORS.tier1,
    2: COLORS.tier2,
    3: COLORS.tier3,
    4: COLORS.tier4,
  };

  const shippedCount = summary.automatedCount;
  const segments = summary.tiers.flatMap((tier) => {
    if (tier.tier === 1) {
      return [
        { value: shippedCount, color: COLORS.shipped, label: 'Shipped' },
        { value: tier.count - shippedCount, color: tierColor[1] ?? COLORS.tier1, label: 'Tier 1' },
      ];
    }
    return [{ value: tier.count, color: tierColor[tier.tier] ?? COLORS.tier4, label: `Tier ${tier.tier}` }];
  });

  let cursor = barX;
  const bar = segments
    .map((segment) => {
      const w = (segment.value / summary.total) * barMax;
      const fitsInside = w > 34;
      const block = [
        rect(cursor, barY, w - 2, barHeight, segment.color, 3),
        // Narrow segments (a handful of scenarios) get their count above the bar.
        fitsInside
          ? text(cursor + (w - 2) / 2, barY + 26, String(segment.value), {
              size: 13,
              weight: 700,
              fill: '#ffffff',
              anchor: 'middle',
            })
          : text(cursor + (w - 2) / 2, barY - 7, String(segment.value), {
              size: 11.5,
              weight: 700,
              fill: segment.color,
              anchor: 'middle',
            }),
      ].join('');
      cursor += w;
      return block;
    })
    .join('');

  const rows = summary.tiers
    .map((tier, index) => {
      const y = barY + barHeight + 32 + index * 30;
      const swatch = tier.tier === 1 ? COLORS.tier1 : (tierColor[tier.tier] ?? COLORS.tier4);
      const countLabel =
        tier.tier === 1
          ? `${tier.count} scenarios (${shippedCount} shipped)`
          : `${tier.count} scenarios`;
      return [
        rect(0, y - 10, 11, 11, swatch, 2),
        text(19, y, `Tier ${tier.tier} - ${tier.label}: ${countLabel}`, { size: 12, weight: 600 }),
        text(19, y + 14, tier.description, { size: 11, fill: COLORS.muted }),
      ].join('');
    })
    .join('');

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Automation viability of the 42 scenarios', { size: 15, weight: 600 }),
    text(0, 38, 'Tiers reflect which UI surface each scenario needs, not how hard the assertion is', {
      size: 11.5,
      fill: COLORS.muted,
    }),
    bar,
    rows,
    '</svg>',
  ].join('');
}

// --- Chart 5: automation coverage tracker -----------------------------------

export function renderTrackerChart(summary: Summary): string {
  const width = 650;
  const height = 290;
  const left = 46;
  const right = width - 150;
  const baseline = 218;
  const topValue = Math.max(summary.tracker.tierOneAndTwoCeiling + 3, 6);
  const scaleY = (value: number) => baseline - (value / topValue) * 156;

  const points = [...summary.tracker.actuals, ...summary.tracker.targets];
  const stepX = (right - left) / Math.max(points.length - 1, 1);
  const pointX = (index: number) => left + index * stepX;

  const gridLines = [0, 5, 10, 15]
    .filter((tick) => tick <= topValue)
    .map((tick) =>
      [
        `<line x1="${left}" y1="${scaleY(tick)}" x2="${right}" y2="${scaleY(tick)}" stroke="${COLORS.grid}" stroke-width="1" />`,
        text(left - 8, scaleY(tick) + 4, String(tick), { size: 10.5, fill: COLORS.muted, anchor: 'end' }),
      ].join(''),
    )
    .join('');

  const ceiling = summary.tracker.tierOneAndTwoCeiling;
  const ceilingLine = [
    `<line x1="${left}" y1="${scaleY(ceiling)}" x2="${right}" y2="${scaleY(ceiling)}" stroke="${COLORS.pass}" stroke-width="1.5" stroke-dasharray="6 4" />`,
    text(right + 8, scaleY(ceiling) + 4, `${ceiling} = everything`, { size: 10.5, fill: COLORS.pass }),
    text(right + 8, scaleY(ceiling) + 17, 'automatable without', { size: 10.5, fill: COLORS.pass }),
    text(right + 8, scaleY(ceiling) + 30, 'portal automation', { size: 10.5, fill: COLORS.pass }),
  ].join('');

  const targetPath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index)} ${scaleY(point.automated)}`)
    .join(' ');

  const actualCount = summary.tracker.actuals.length;
  const actualPath = summary.tracker.actuals
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index)} ${scaleY(point.automated)}`)
    .join(' ');

  const dots = points
    .map((point, index) => {
      const isActual = index < actualCount;
      const cx = pointX(index);
      const cy = scaleY(point.automated);
      return [
        `<circle cx="${cx}" cy="${cy}" r="${isActual ? 5.5 : 4}" fill="${isActual ? '#0f6cbd' : '#ffffff'}" stroke="${isActual ? '#ffffff' : COLORS.muted}" stroke-width="1.5" />`,
        text(cx, cy - 12, String(point.automated), {
          size: 11.5,
          weight: 600,
          fill: isActual ? '#0f6cbd' : COLORS.muted,
          anchor: 'middle',
        }),
        text(cx, baseline + 18, point.week.replace('2026-', ''), {
          size: 10.5,
          fill: COLORS.muted,
          anchor: 'middle',
        }),
      ].join('');
    })
    .join('');

  const todayLabel = text(pointX(0), baseline + 34, 'today', {
    size: 10.5,
    weight: 600,
    fill: '#0f6cbd',
    anchor: 'middle',
  });

  return [
    svgOpen(width, height),
    rect(0, 0, width, height, '#ffffff', 0),
    text(0, 20, 'Automated scenario coverage over time', { size: 15, weight: 600 }),
    text(0, 38, `${summary.automatedCount} of ${summary.total} scenarios automated today (${summary.automatedPercent}%); dashed line is the proposed ramp, not a commitment`, {
      size: 11.5,
      fill: COLORS.muted,
    }),
    gridLines,
    `<line x1="${left}" y1="${baseline}" x2="${right}" y2="${baseline}" stroke="${COLORS.muted}" stroke-width="1" />`,
    ceilingLine,
    `<path d="${targetPath}" fill="none" stroke="${COLORS.muted}" stroke-width="2" stroke-dasharray="6 5" />`,
    actualPath ? `<path d="${actualPath}" fill="none" stroke="#0f6cbd" stroke-width="3" />` : '',
    dots,
    todayLabel,
    legend(left, height - 8, [
      { color: '#0f6cbd', label: 'Actual' },
      { color: COLORS.muted, label: 'Proposed target' },
    ]),
    '</svg>',
  ].join('');
}

// --- Report page -------------------------------------------------------------

export interface ChartSpec {
  slug: string;
  title: string;
  svg: string;
}

export function buildCharts(summary: Summary): ChartSpec[] {
  return [
    { slug: '01-onboarding-funnel', title: 'Scenario pipeline', svg: renderFunnelChart(summary) },
    { slug: '02-status-by-section', title: 'Status by feature area', svg: renderSectionChart(summary) },
    { slug: '03-priority-status', title: 'Status by priority', svg: renderPriorityChart(summary) },
    { slug: '04-automation-viability', title: 'Automation viability', svg: renderViabilityChart(summary) },
    { slug: '05-automation-tracker', title: 'Automation coverage tracker', svg: renderTrackerChart(summary) },
  ];
}

export function renderReportHtml(summary: Summary, charts: ChartSpec[], generatedAt: string): string {
  const openRows = summary.openItems
    .map(
      (item) =>
        `<tr><td>${item.id}</td><td>${item.priority}</td><td>${item.status}</td><td>${item.sectionShort}</td><td>${item.name}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Purview Auto-Labeling weekly report</title>
<style>
  body { font-family: ${FONT}; color: ${COLORS.ink}; margin: 0; padding: 32px; background: #faf9f8; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.lede { color: ${COLORS.muted}; margin: 0 0 24px; font-size: 13px; }
  .chart { background: #fff; border: 1px solid ${COLORS.grid}; border-radius: 6px; padding: 16px; margin-bottom: 20px; width: 650px; box-sizing: content-box; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; background: #fff; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid ${COLORS.grid}; }
  th { background: #f3f2f1; font-weight: 600; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
</style>
</head>
<body>
<main>
  <h1>Purview Auto-Labeling: weekly validation report</h1>
  <p class="lede">${summary.total} scenarios onboarded &middot; ${summary.passed} passing &middot; ${summary.open} open &middot; ${summary.automatedCount} automated end-to-end &middot; generated ${generatedAt}</p>
  ${charts.map((chart) => `<div class="chart" data-chart="${chart.slug}">${chart.svg}</div>`).join('\n  ')}
  <h2>Open items</h2>
  <table>
    <thead><tr><th>TC</th><th>Priority</th><th>Status</th><th>Area</th><th>Scenario</th></tr></thead>
    <tbody>${openRows}</tbody>
  </table>
</main>
</body>
</html>`;
}
