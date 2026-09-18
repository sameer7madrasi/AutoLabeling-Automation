# Encryption report email - ready to send

Paste the body below into Outlook and drop each PNG in at its marker. Charts are in
`reports/encryption/charts/`, and `reports/encryption/encryption-report.html` carries the same
charts plus the category, defect and phase tables if you would rather attach one file.

Every figure below is generated from `reports/encryption/data/test-cases.json` by
`npm run report:encryption`, which fails if this wording stops matching the sheet.

---

**Subject:** Encryption test suite - execution status, trajectory and automation plan (W0 baseline)

---

Hi <Encryption team contact>,

Please find below the execution status summary for the Encryption test suite covering Encrypt Only,
Do Not Forward, and Internal Confidential. This cycle is our W0 baseline: from here we will report
the same numbers every cycle so the trend is visible, and we are starting to automate the matrix.

## SCOPE

Testing covers three protection templates: Encrypt Only (EO), Do Not Forward (DNF), and Internal
Confidential (IC), triggered via Label, Subject keyword, and Default Template/Option. Each trigger
was validated across Reply, Reply All, and Forward actions, across OWA / WODC Classic / WODC New
clients, and across Prod, SDF, Gmail, Yahoo, and Hotmail tenant and recipient combinations.

## EXECUTION STATUS

[INSERT reports/encryption/charts/01-execution-status.png]

The suite holds **1,470 populated test cases**: 1,140 executed (946 pass, 194 fail) and 330 not
applicable by design. That gives a pass rate of **83.0%** on executed cases.

One bookkeeping note, so the totals reconcile against the workbook. The three DNF tabs each carry 70
unpopulated placeholder rows (TC 141-210, spreadsheet rows 157-232): they hold a TC ID and nothing
else, no scenario, client, tenant, action, verification or status. That is consistent with the
Details tab, which lists Do Not Forward with Reply and Reply All only, since DNF blocks forwarding.
So the planned ID range is 1,680 while the real, populated suite is 1,470. Our numbers below use
1,470 throughout. Worth a decision on your side: either retire those stub rows, or repurpose them as
explicit negative cases that assert forwarding is blocked, which is exactly where we found a defect
this cycle.

[INSERT reports/encryption/charts/02-status-by-category.png]

| Protection category | Cases | Pass | Fail | Not applicable | Pass rate |
| --- | --- | --- | --- | --- | --- |
| DNF-Subject | 140 | 80 | 28 | 32 | 74.1% |
| DNF-Default template | 140 | 80 | 28 | 32 | 74.1% |
| DNF-Label | 140 | 84 | 28 | 28 | 75.0% |
| EO-Options | 210 | 126 | 36 | 48 | 77.8% |
| EO-Label | 210 | 128 | 34 | 48 | 79.0% |
| EO-Subject | 210 | 130 | 34 | 46 | 79.3% |
| IC-Label | 210 | 159 | 3 | 48 | 98.1% |
| IC-Subject | 210 | 159 | 3 | 48 | 98.1% |
| **Total** | **1,470** | **946** | **194** | **330** | **83.0%** |

Internal Confidential is effectively clean at 98.1%. Do Not Forward trails the set at 74-75%, and
Encrypt Only sits just under 80%. The pattern is consistent across all three trigger types, which
points at the template behaviour rather than at how the template is applied.

## TRAJECTORY

[INSERT reports/encryption/charts/03-trajectory.png]

We are tracking two lines from now on: pass rate on executed cases, and execution coverage (executed
divided by populated). W0 is 83.0% pass at 77.6% coverage. Each cycle appends one point, so by W2 we
will be able to say whether fixes are landing faster than regressions appear.

[INSERT reports/encryption/charts/04-feature-tracker.png]

The per-feature tracker is the same idea at category level, so a regression in one template shows up
immediately instead of being averaged away in the total.

## DEFECT CONCENTRATION

[INSERT reports/encryption/charts/05-defect-concentration.png]

The 194 failures are not 194 independent problems. They trace back to five defect classes, and two of
them account for 174 cases:

| Defect | Severity | Cases | Where it shows up |
| --- | --- | --- | --- |
| Gmail attachment preview and filename | Medium | 87 | Gmail recipients, all EO and DNF templates |
| Yahoo PDF filename | Medium | 87 | Yahoo recipients, all EO and DNF templates |
| DNF forward not blocked | High | 12 | WODC Classic to Classic and New to New, SDF tenants |
| OME wrapper missing | High | 6 | WODC Classic to Classic, Internal Confidential |
| Attachment preview (xlsx) | Low | 2 | Hotmail recipients |

Two things worth your attention. **`Forward is enabled` on Do Not Forward is the one to prioritise**:
it is only 12 cases, but it is a failed security control rather than a rendering issue. And both
high-severity classes appear **only in desktop client pairs** - nothing in OWA-to-OWA reproduces
them, which is useful for narrowing down where to look.

Full detail with screenshots is in the Active Bug List document shared alongside this report.

## AUTOMATION PLAN

[INSERT reports/encryption/charts/06-automation-viability.png]

We already have a Playwright harness running weekly against Purview auto-labeling: human-assisted
sign-in with a reused session, unique per-run subjects for deterministic correlation, polling instead
of fixed waits, and PASS/FAIL plus JSON results with automatic failure artefacts. The encryption
suite can reuse all of it. What decides cost here is not the assertion, it is which client surface a
case needs, so we have split the matrix three ways:

**Tier A - runs on today's harness: 126 cases.** OWA to OWA, recipient in Prod, SDF or Outlook.com.
Assertions: message encrypted with the expected template, forward disabled on DNF, OME wrapper
present, and all four attachments arriving with their original file names. All 126 currently pass, so
the value here is regression protection over a large repetitive matrix rather than new bug discovery.

**Tier B - web plus IMAP: 84 cases.** OWA to OWA with Gmail or Yahoo recipients, which is where 58 of
the 194 failures live. We would verify these over IMAP rather than driving consumer webmail, because
the two dominant defects are MIME-level: "random file name" and "no file name displayed" are
attachment metadata, checkable without a browser. Preview rendering inside Gmail and Yahoo stays
manual.

That makes **210 cases (14.3%)** reachable with web plus IMAP automation.

**Tier C - stays manual: 1,260 cases (85.7%).** Any pair with WODC Classic or WODC New on either
side. WODC New is WebView2-based so attaching a browser automation session is plausible but unproven;
WODC Classic needs Windows UI automation, which is a different toolchain and a separate decision. We
want to be straight about the implication: both high-severity defects this cycle were found in Tier C,
so automation will cut the cost of the repetitive matrix but will not replace the desktop pass.

Sequencing, in dependency order rather than by date:

| Phase | Work | Unlocks |
| --- | --- | --- |
| 1 | Harness extension: triggers (label, subject keywords `ETRENCRYPTTEST` / `ETRDONOTFORWARDTEST` / `ETRINTERNALCONFIDENTIALTEST`, Options/default template), Reply / Reply All / Forward, the docx+pdf+xlsx+txt fixture set, and encryption assertions | First end-to-end encryption scenario |
| 2 | Tier A matrix runner, data-driven from the same case list so the matrix stays in data not code | 126 cases |
| 3 | IMAP verifier for consumer recipients using app passwords | 84 cases, transport-level assertions |
| 4 | Feed run results into the weekly history so these charts update themselves | Self-maintaining report |

Risks we are carrying, stated plainly: consumer webmail actively resists browser automation, which is
why Tier B goes over IMAP; sessions expire, so the harness falls back to human-assisted sign-in
rather than storing credentials; attachment preview is inherently visual, so screenshot comparison is
the only realistic automated form and we are deferring it; and the encryption templates plus ETR
subject keywords need to stay stable, since the tests assert against them rather than creating them.

What would help from your side: confirmation that the ETR keywords and the three templates are
permanent fixtures in the test tenants, a view on whether the DNF placeholder rows should become
negative forward-blocked cases, and a call on whether desktop automation is something you want us to
scope at all.

Happy to walk through any section, or to demo the existing auto-labeling automation so you can see
the shape of what Tier A would look like.

Thanks,
<your name>

---

## Internal notes (delete before sending)

- Regenerate charts and summary: `npm run report:encryption`. Output lands in
  `reports/encryption/charts/`, `encryption-report.html` and `data/summary.json`.
- After each cycle, append one entry to `weeks` in `reports/encryption/data/weekly-history.json`
  (pass, fail, notApplicable, passRate, coverage, byCategory) and rebuild. Charts 03 and 04 fill in
  the next column automatically.
- The build reconciles per-tab counts (210/210/210/140/140/140/210/210), status sums, per-category
  pass rates, tier totals and defect totals against the workbook, and checks this draft still quotes
  the live figures. If a number changes in the sheet, re-extract and the build will flag the wording.
- Status changes belong in `reports/encryption/data/test-cases.json`, which mirrors the workbook.
