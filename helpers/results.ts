import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { RESULTS_DIR, SCREENSHOTS_DIR } from './config';
import type { LabelCandidate } from './outlook';

export interface RunArtifacts {
  screenshot?: string;
  html?: string;
  labelCandidates?: string;
}

export interface RunResult {
  scenario: string;
  subject: string;
  sitTrigger: string;
  expectedLabel: string;
  actualLabel: string | null;
  emailReceived: boolean;
  labelApplied: boolean;
  result: 'PASS' | 'FAIL';
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  failureReason: string | null;
  artifacts: RunArtifacts;
}

/** Filesystem-safe timestamp, e.g. 2026-09-17T08-19-04-123Z. */
export function fileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Captures the artifacts a failed run needs: screenshot, page HTML, label candidates. */
export async function saveFailureArtifacts(
  page: Page,
  subject: string,
  labelCandidates: LabelCandidate[],
): Promise<RunArtifacts> {
  ensureDir(RESULTS_DIR);
  ensureDir(SCREENSHOTS_DIR);

  const stamp = fileTimestamp();
  const base = `${stamp}-${subject}`;
  const artifacts: RunArtifacts = {};

  const screenshotPath = path.join(SCREENSHOTS_DIR, `${base}.png`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.screenshot = screenshotPath;
  } catch (error) {
    console.log(`[artifacts] Screenshot failed: ${describeError(error)}`);
  }

  const htmlPath = path.join(RESULTS_DIR, `${base}.html`);
  try {
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    artifacts.html = htmlPath;
  } catch (error) {
    console.log(`[artifacts] HTML capture failed: ${describeError(error)}`);
  }

  const candidatesPath = path.join(RESULTS_DIR, `${base}-label-candidates.json`);
  try {
    fs.writeFileSync(candidatesPath, JSON.stringify(labelCandidates, null, 2), 'utf8');
    artifacts.labelCandidates = candidatesPath;
  } catch (error) {
    console.log(`[artifacts] Label candidate dump failed: ${describeError(error)}`);
  }

  return artifacts;
}

export function writeResultJson(result: RunResult): string {
  ensureDir(RESULTS_DIR);
  const resultPath = path.join(RESULTS_DIR, `${fileTimestamp(new Date(result.completedAt))}.json`);
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return resultPath;
}

export function printSummary(result: RunResult, resultPath: string): void {
  const divider = '='.repeat(50);
  const lines = [
    '',
    divider,
    'EXO AUTO-LABEL ENFORCEMENT E2E',
    divider,
    '',
    `Subject:          ${result.subject}`,
    `SIT Trigger:      ${result.sitTrigger}`,
    `Expected Label:   ${result.expectedLabel}`,
    `Actual Label:     ${result.actualLabel ?? '(none detected)'}`,
    '',
    `Email Received:   ${result.emailReceived ? 'PASS' : 'FAIL'}`,
    `Label Applied:    ${result.labelApplied ? 'PASS' : 'FAIL'}`,
    '',
    `Total Duration:   ${formatDuration(result.durationSeconds)}`,
    `RESULT:           ${result.result}`,
    divider,
  ];

  if (result.result === 'FAIL') {
    lines.push(`Failure reason:   ${result.failureReason ?? 'Unknown failure.'}`);
    if (result.artifacts.screenshot) lines.push(`Screenshot:       ${result.artifacts.screenshot}`);
    if (result.artifacts.html) lines.push(`Page HTML:        ${result.artifacts.html}`);
    if (result.artifacts.labelCandidates) lines.push(`Label candidates: ${result.artifacts.labelCandidates}`);
    if (result.emailReceived && !result.labelApplied) {
      lines.push(
        'Note:             The message arrived but no matching sensitivity label was detected.',
        '                  Either the Auto-Labeling policy has not enforced yet, or the label',
        '                  locator needs refinement - see helpers/outlook.ts (getSensitivityLabel)',
        '                  and re-run with DEBUG_LABEL_LOCATOR=true.',
      );
    }
    lines.push(divider);
  }

  lines.push(`JSON result:      ${resultPath}`, divider, '');
  console.log(lines.join('\n'));
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
