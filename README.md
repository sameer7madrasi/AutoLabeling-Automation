# Auto-Labeling EXO E2E Automation PoC

Automates the weekly manual validation of a **Microsoft Purview Auto-Labeling** enforcement
scenario in **Exchange Online**, driven entirely through the Outlook Web UI with Playwright.

## Purpose

| | |
| --- | --- |
| Scenario | EXO Auto-Label Enforcement |
| Workload | Exchange Online |
| SIT trigger text | `SingleLocationScope-Enforcement-SIT` |
| Expected sensitivity label | `EnforcementTest-Label` |
| Outcome | One PASS/FAIL result per run, in the console and as JSON |
| Status | Verified end-to-end against a live tenant: send, delivery, and label detection all pass |

### Manual process being automated

1. Send a test email containing the SIT trigger text to the test mailbox.
2. Wait for the message to be delivered.
3. Wait for the Auto-Labeling policy to enforce.
4. Open the message and confirm the sensitivity label is `EnforcementTest-Label`.

### Automated process

Playwright drives the same workflow end-to-end in a real Chromium browser against Outlook Web:
compose → send → poll the inbox for this run's unique subject → open the message → poll the
message header until the expected sensitivity label appears → report PASS/FAIL.

## Design decisions worth knowing

- **The Auto-Labeling policy is assumed to already exist.** This project never creates, modifies
  or reads Purview policy configuration. It only observes the effect of the existing policy.
- **Authentication is intentionally human-assisted.** The first run opens Chromium, the tester
  completes Microsoft password + MFA by hand, and the test continues automatically once the
  mailbox loads. Passwords and MFA are never automated.
- **No credentials are stored.** There is no password in code, config, or `.env`. Only the
  browser session (`playwright/.auth/user.json`) is cached locally, and it is git-ignored.
- **No Microsoft Graph, no app registration, no admin consent.** Everything happens through the
  same UI a human tester uses, which is what makes this a faithful validation of the scenario.
- **Unique subject per run** (`AUTO-AL-EXO-<timestamp>`) gives deterministic correlation: the run
  only ever looks at the message it just sent, so a stale test email cannot produce a false PASS.
- **Polling, not sleeping.** Delivery and policy enforcement are asynchronous, so the test polls
  on a configurable interval and passes the instant the expected label is detected.
- **Failures explain themselves.** A failed run captures a full-page screenshot, the page HTML,
  a dump of every DOM element mentioning sensitivity/label/enforcement, a Playwright trace, and
  a JSON result file.
- **Policy notification mail is explicitly rejected.** When the tenant emails a
  "Notification: &lt;subject&gt;" mail about the test message, that mail contains our unique subject
  as a substring *and* quotes the label name in its body. The run excludes notification rows and
  verifies the opened message's header subject before reading the label, so the check can only
  ever pass on the delivered message.

## Tenant UI variations already handled

Outlook Web ships in more than one shape, and both are supported:

| Element | Simplified ribbon | Classic ribbon (verified tenant) |
| --- | --- | --- |
| Compose button | `New mail` | `New` (`data-automation-type="RibbonSplitButton"`) |
| Recipient field | role `textbox`/`combobox` named `To` | `div[aria-label="To"][contenteditable="true"]`, no role |
| Sensitivity label | accessible name containing "Sensitivity" | bare text span beside a `ShieldBundled` icon |

All candidate locators live in the `*_CANDIDATES` arrays and `LABEL_CHIP_SELECTORS` at the top of
`helpers/outlook.ts`, tried in order, so a third variation is a one-line addition.

## Prerequisites

- Node.js 18 or newer (`node -v`) and npm.
- A Microsoft 365 test user in the tenant where the Auto-Labeling policy is scoped, licensed for
  Exchange Online and able to sign in to Outlook Web.
- A desktop session (the browser runs headed so you can sign in).
- The Auto-Labeling policy already published, with the `EnforcementTest-Label` label available.

## Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env      # Windows: copy .env.example .env
```

## Quickstart on Windows

Everything in this repo is cross-platform; only the shell syntax differs. In PowerShell:

```powershell
node -v                   # must be v18 or newer - install from https://nodejs.org if missing
git clone https://github.com/sameer7madrasi/AutoLabeling-Automation.git
cd AutoLabeling-Automation
npm install
npx playwright install chromium
Copy-Item .env.example .env
notepad .env              # set TEST_USER_EMAIL, save, close
npm test
```

In `cmd.exe`, use `copy .env.example .env` instead of `Copy-Item`.

Setting the debug flag needs PowerShell syntax, since `DEBUG_LABEL_LOCATOR=true npm test` is
bash-only:

```powershell
$env:DEBUG_LABEL_LOCATOR="true"; npm test; Remove-Item Env:DEBUG_LABEL_LOCATOR
```

A real Chromium window opens so you can sign in, so run this on your desktop session rather than
over a headless remote shell. `npm run auth:reset` clears the cached Outlook session if you need
to sign in as a different user.

## Configuration

Edit `.env`:

```ini
TEST_USER_EMAIL=autolabel.tester@contoso.onmicrosoft.com
OUTLOOK_URL=https://outlook.office.com/mail/
EXPECTED_LABEL=EnforcementTest-Label
SIT_TRIGGER=SingleLocationScope-Enforcement-SIT
```

Optional tuning (defaults in parentheses):

| Variable | Purpose |
| --- | --- |
| `EMAIL_ARRIVAL_TIMEOUT_MINUTES` (10) | Max wait for the message to appear in the inbox |
| `LABEL_TIMEOUT_MINUTES` (10) | Max wait for Auto-Labeling to stamp the label |
| `POLL_INTERVAL_SECONDS` (20) | Interval used for both polling loops |
| `LOGIN_TIMEOUT_MINUTES` (5) | Time allowed for manual Microsoft login / MFA |
| `DEBUG_LABEL_LOCATOR` (false) | Print candidate sensitivity-label DOM elements each poll |

`TEST_USER_EMAIL` is required; the run fails immediately with a clear message if it is missing.
**Never add a password to `.env`.**

## How to run

```bash
npm test            # headed Chromium (default)
npm run test:headed # explicitly headed
npm run test:debug  # Playwright Inspector, step through the flow
npm run typecheck   # TypeScript strict compile, no browser needed
npm run auth:reset  # forget the saved Outlook session and sign in again
npm run report      # open the HTML report from the last run
```

First run: Chromium opens on the Microsoft sign-in page and the terminal prints an
`ACTION REQUIRED` banner. Sign in as the test user, complete MFA, choose "Stay signed in", and
the test resumes on its own. Subsequent runs reuse `playwright/.auth/user.json`; if that session
has expired, the test falls back to the interactive prompt automatically.

## Expected output

```text
==================================================
EXO AUTO-LABEL ENFORCEMENT E2E
==================================================

Subject:          AUTO-AL-EXO-1789633678567
SIT Trigger:      SingleLocationScope-Enforcement-SIT
Expected Label:   EnforcementTest-Label
Actual Label:     EnforcementTest-Label

Email Received:   PASS
Label Applied:    PASS

Total Duration:   2m 41s
RESULT:           PASS
==================================================
JSON result:      results/2026-09-17T08-28-08-951Z.json
==================================================
```

Every run also writes `results/<timestamp>.json`:

```json
{
  "scenario": "EXO Auto-Label Enforcement",
  "subject": "AUTO-AL-EXO-1789633678567",
  "sitTrigger": "SingleLocationScope-Enforcement-SIT",
  "expectedLabel": "EnforcementTest-Label",
  "actualLabel": "EnforcementTest-Label",
  "emailReceived": true,
  "labelApplied": true,
  "result": "PASS",
  "startedAt": "2026-09-17T08:26:18.451Z",
  "completedAt": "2026-09-17T08:28:59.451Z",
  "durationSeconds": 161,
  "failureReason": null,
  "artifacts": {}
}
```

Failure artifacts:

| Artifact | Location |
| --- | --- |
| Full-page screenshot | `screenshots/<timestamp>-<subject>.png` |
| Page HTML for inspection | `results/<timestamp>-<subject>.html` |
| Sensitivity-label DOM candidates | `results/<timestamp>-<subject>-label-candidates.json` |
| Playwright trace + report | `test-results/`, `playwright-report/` |

## Project structure

```text
tests/exo-enforcement.spec.ts   The single E2E test: send -> receive -> verify label
helpers/outlook.ts              Outlook Web interactions and all locator candidates
helpers/results.ts              Console summary, JSON result file, failure artifacts
helpers/config.ts               Environment variable loading and validation
playwright.config.ts            Chromium, headed, traces/screenshots on failure
results/, screenshots/          Run output (git-ignored except .gitkeep)
reports/                        Weekly scenario status report pack (see below)
```

## Weekly status report pack

`reports/` turns the PM's scenario sheet into a status report: five charts, a summary JSON, and a
ready-to-send email draft.

```bash
npm run report:build   # regenerates charts, weekly-report.html and data/summary.json
```

| Path | What it is |
| --- | --- |
| `reports/data/test-cases.json` | All 42 scenarios with priority, status, automation tier and rationale. Edit this when a status changes. |
| `reports/data/automation-history.json` | Weekly automation-coverage tracker. Append one entry to `actuals` each week. |
| `reports/data/summary.json` | Derived figures, regenerated by the build. |
| `reports/charts/*.png` | Charts sized for pasting into email at 650 px wide. |
| `reports/weekly-report.html` | All charts plus the open-items table in one page. |
| `reports/email-draft.md` | Paste-ready email body with markers for each chart. |

The build asserts that section, priority and tier counts all reconcile to the total, that the tracker
matches the number of automated scenarios, and that `email-draft.md` still quotes the live figures, so
the narrative cannot drift from the data.

## Troubleshooting

**"Could not find \<element\> in Outlook Web"** — your tenant's OWA build uses a different
accessible name. Every locator lives in one place: the `*_CANDIDATES` arrays at the top of
`helpers/outlook.ts`. Add your variant to the relevant array; the helpers try candidates in order.

**The email arrives but the label is never detected.** Confirm by hand whether Outlook shows
`EnforcementTest-Label` on the message. If it does, the label locator needs refinement:

```bash
DEBUG_LABEL_LOCATOR=true npm test
```

This prints every element whose `aria-label`, `title` or text mentions sensitivity / label /
enforcement, and the same list is saved to `results/<timestamp>-<subject>-label-candidates.json`.
Use it to extend `getSensitivityLabel()` in `helpers/outlook.ts` (see the `LABEL_NAME_PATTERNS`
list for the accessible-name shapes already handled).

**Policy enforcement is slower than the timeout.** Raise `LABEL_TIMEOUT_MINUTES`. Auto-Labeling
for Exchange is asynchronous and can take noticeably longer than delivery.

**The message is not found in the inbox.** The test first refreshes the message list, then falls
back to Outlook search. If it still fails, check Sent Items and mail flow for the test mailbox.

**Sign-in loop or expired session.** Run `npm run auth:reset` and sign in again.

**Recipient not resolved / compose stayed open.** Outlook may be showing a policy tip or an
address-resolution error. Check the failure screenshot and confirm `TEST_USER_EMAIL` is exact.

## Limitations

- Proof of concept: one scenario, one workload (Exchange Online), one label.
- Headed and interactive by design, so it is not suitable for unattended CI as-is.
- UI-based validation depends on the tenant's Outlook Web build; locators may need small edits.
- The test proves the label Outlook displays on the received message, not the underlying
  Purview audit record.
- No retries: a run is a single deterministic observation, which is what a weekly manual check is.

## Future work

Not implemented here, deliberately:

- SharePoint Auto-Labeling scenarios.
- OneDrive Auto-Labeling scenarios.
- Policy simulation-mode validation.
- Activity Explorer / audit-record cross-validation.
- Reporting or dashboard integration for trend tracking across weekly runs.
