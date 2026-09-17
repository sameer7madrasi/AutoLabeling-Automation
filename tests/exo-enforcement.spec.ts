import { expect, test } from '@playwright/test';
import { loadConfig, totalTestTimeoutMs } from '../helpers/config';
import {
  collectLabelCandidates,
  ensureAuthenticated,
  getSensitivityLabel,
  printLabelCandidates,
  reopenMessage,
  sendEmail,
  waitForAndOpenMessage,
  waitForSensitivityLabel,
} from '../helpers/outlook';
import {
  describeError,
  printSummary,
  saveFailureArtifacts,
  writeResultJson,
  type RunResult,
} from '../helpers/results';

const config = loadConfig();

test.describe.configure({ mode: 'serial' });

test('EXO Auto-Label enforcement: SIT email is stamped with the expected sensitivity label', async ({
  page,
}) => {
  test.setTimeout(totalTestTimeoutMs(config));

  const startedAt = new Date();
  // Unique per run, so a stale test email can never make this test pass.
  const subject = `AUTO-AL-EXO-${Date.now()}`;

  const result: RunResult = {
    scenario: 'EXO Auto-Label Enforcement',
    subject,
    sitTrigger: config.sitTrigger,
    expectedLabel: config.expectedLabel,
    actualLabel: null,
    emailReceived: false,
    labelApplied: false,
    result: 'FAIL',
    startedAt: startedAt.toISOString(),
    completedAt: startedAt.toISOString(),
    durationSeconds: 0,
    failureReason: null,
    artifacts: {},
  };

  try {
    await test.step('Confirm the Outlook inbox is loaded', async () => {
      await ensureAuthenticated(page, config);
    });

    await test.step(`Send the SIT email to ${config.testUserEmail}`, async () => {
      console.log(`[send] Subject: ${subject}`);
      await sendEmail(page, {
        to: config.testUserEmail,
        subject,
        body: config.sitTrigger,
      });
      console.log('[send] Message submitted.');
    });

    await test.step('Wait for the message to arrive and open it', async () => {
      await waitForAndOpenMessage(page, subject, config);
      result.emailReceived = true;
      console.log('[inbox] Message received and opened.');
    });

    await test.step(`Verify the sensitivity label "${config.expectedLabel}"`, async () => {
      let reopenCount = 0;
      const labelCheck = await waitForSensitivityLabel(page, config.expectedLabel, config.labelTimeoutMs, {
        intervalMs: config.pollIntervalMs,
        onRetry: async (attempt) => {
          if (config.debugLabelLocator) {
            printLabelCandidates(await collectLabelCandidates(page));
          }
          // Outlook caches header metadata, so periodically re-open the message.
          if (attempt % 3 === 0) {
            reopenCount += 1;
            console.log(`[label] Re-opening the message to refresh metadata (#${reopenCount}).`);
            await reopenMessage(page, subject, config);
          }
        },
      });

      result.labelApplied = labelCheck.found;
      result.actualLabel = labelCheck.actualLabel ?? (await getSensitivityLabel(page));

      if (!labelCheck.found) {
        result.failureReason =
          `Expected sensitivity label "${config.expectedLabel}" was not detected within ` +
          `${Math.round(config.labelTimeoutMs / 60_000)} minute(s). ` +
          (result.actualLabel
            ? `Last detected label: "${result.actualLabel}".`
            : 'No sensitivity label element could be interpreted - the locator may need refinement.');
      }
    });
  } catch (error) {
    result.failureReason = describeError(error);
    console.log(`[error] ${result.failureReason}`);
  }

  if (!result.emailReceived || !result.labelApplied) {
    const candidates = await collectLabelCandidates(page);
    printLabelCandidates(candidates);
    result.artifacts = await saveFailureArtifacts(page, subject, candidates);
  }

  const completedAt = new Date();
  result.completedAt = completedAt.toISOString();
  result.durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
  result.result = result.emailReceived && result.labelApplied ? 'PASS' : 'FAIL';

  printSummary(result, writeResultJson(result));

  expect(result.emailReceived, `Email "${subject}" was never received: ${result.failureReason}`).toBe(true);
  expect(result.labelApplied, result.failureReason ?? 'Sensitivity label was not applied.').toBe(true);
  expect(result.actualLabel?.trim().toLowerCase()).toBe(config.expectedLabel.trim().toLowerCase());
});
