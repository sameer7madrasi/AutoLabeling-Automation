# Weekly report email - ready to send

Paste the body below into Outlook and drop each PNG in at its marker. The charts are in
`reports/charts/`, the label evidence is in `reports/evidence/`, and `reports/weekly-report.html`
has the same charts plus the open-items table if you would rather attach one file.

Everything quoted below is generated from `reports/data/test-cases.json` by `npm run report:build`,
which fails if the numbers here stop matching the data.

---

**Subject:** Auto-Labeling weekly validation: 34 of 42 scenarios passing, first scenario now automated end-to-end

---

Hi <PM name>,

Here is the first consolidated update on the auto-labeling scenario set you shared: where the manual
validation stands, and where we have got to on automating it.

**Headline.** All 42 scenarios are onboarded and documented. 34 of 42 are executed and passing, with
8 open: 7 awaiting execution and 1 blocked on a clarification from you. The first scenario is now
automated end-to-end against the live tenant, so automated coverage stands at 1 of 42 and a full run
takes about 30 seconds.

[INSERT reports/charts/01-onboarding-funnel.png]

## 1. What was shared, onboarded, and still open

You shared 42 test cases across 9 feature areas, plus 10 environment prerequisites. All 42 are
onboarded: documented with steps, expected results, priority, and a current status. Nothing from the
sheet has been dropped or deferred.

Still to execute (7, all documented and ready):

| TC | Priority | Area | Scenario |
| --- | --- | --- | --- |
| TC-008 | P1 | Override label | Override Label - Without Override Enabled |
| TC-010 | P1 | Remove label | Remove Label - SPO |
| TC-011 | P1 | Remove label | Remove Label - ODB |
| TC-017 | P2 | Simulation mode | Simulation - Auto-Enable After (Scheduled Enforcement) |
| TC-019 | P2 | Negative & edge | Edge Case - Multiple File Types |
| TC-020 | P3 | Negative & edge | Edge Case - Large File (>10 MB) |
| TC-021 | P2 | Negative & edge | Edge Case - Failed Labeling |

Needs clarification (1):

- **TC-032, Simulation Overview - Simulation Accuracy (Policy Grading).** We cannot define pass
  criteria until we know whether policy grading is expected to be enabled in this tenant, and what
  the accuracy panel should show when it is (accuracy rate, true and false positive counts, graded
  versus ungraded, per-SIT breakdown). Until then this one stays unexecuted rather than failed.

## 2. Feature-level breakdown

[INSERT reports/charts/02-status-by-section.png]

| Feature area | Passing | Open |
| --- | --- | --- |
| S1 Apply label - enforcement (SIT) | 5 / 5 | - |
| S2 Override existing labels | 3 / 4 | TC-008 |
| S3 Remove label | 1 / 3 | TC-010, TC-011 |
| S4 Simulation mode | 4 / 5 | TC-017 |
| S5 Negative & edge cases | 1 / 4 | TC-019, TC-020, TC-021 |
| S6 Policy management | 3 / 3 | - |
| S7 Reporting UX - Simulation overview | 7 / 8 | TC-032 |
| S8 Reporting UX - Enforcement overview | 9 / 9 | - |
| S9 Activity Explorer | 1 / 1 | - |

Enforcement, policy management, the enforcement reporting surface, and Activity Explorer are fully
green. The concentration of open work is in **Remove label** (1 of 3 passing) and **Negative and edge
cases** (1 of 4 passing), and those two areas hold 2 of the 3 open P1 items.

[INSERT reports/charts/03-priority-status.png]

## 3. Automation update

**TC-003, Apply Label Enforcement - SIT in Exchange Online, is now automated and passing.** It runs
the same steps a tester would, in a real browser against Outlook Web:

1. Sends an email to the test mailbox whose body contains the SIT trigger text.
2. Polls the inbox for that message using a subject that is unique to the run
   (`AUTO-AL-EXO-<timestamp>`).
3. Opens the delivered message and confirms the header subject matches exactly.
4. Polls the message header until the expected sensitivity label appears.
5. Prints a PASS or FAIL summary and writes a machine-readable JSON result.

[INSERT reports/evidence/tc-003-label-applied.png]

One deviation worth flagging: the tenant policy we validate against uses
`SingleLocationScope-Enforcement-SIT` and applies `EnforcementTest-Label`, whereas TC-003 in the
sheet specifies a Credit Card SIT applying `Confidential`. The scenario shape is identical, so we
have reported it as TC-003 coverage, but we should agree whether to align the sheet with the tenant
or add the tenant policy to it.

Three design points that make the result trustworthy:

- **Unique subject per run**, so a stale test email from a previous week can never produce a pass.
- **Notification mail is explicitly rejected.** The tenant sends a second "Notification: <subject>"
  mail for each test message, and that mail quotes the label name in its body. An early version of
  the test read the label from it, which would have been a false pass. The run now excludes those
  rows, verifies the opened message's subject, and logs which message it inspected.
- **No Graph API, no app registration, no stored credentials.** Sign-in is human-assisted once, then
  the session is reused. This deliberately keeps the test on the same path a real user takes.

## 4. How automatable is the rest?

[INSERT reports/charts/04-automation-viability.png]

The tiers describe which UI surface a scenario needs, which is what actually drives cost:

- **Tier 1, automatable now (3 scenarios).** Validated entirely in Outlook Web against policies that
  already exist in the tenant. TC-003 is done; TC-009 (override in EXO) and the EXO leg of TC-018
  (negative, no SIT match) are next and need no new policy work, because `OverrideLabel-SIT` and the
  enforcement policies are already live.
- **Tier 2, needs SharePoint and OneDrive automation (12 scenarios).** Structurally identical to
  TC-003, but the test has to upload a file and read the label back from the file UI instead of a
  message header. This is the single highest-leverage investment: it unlocks 12 scenarios.
- **Tier 3, needs Purview portal automation (25 scenarios).** Either the test has to create, edit,
  enable, or delete a policy, or the assertion lives on a Purview report surface such as the
  simulation and enforcement overviews or Activity Explorer. Most of the reporting cases are visual
  assertions about charts, which are better served by screenshot comparison than by DOM assertions.
- **Tier 4, manual for now (2 scenarios).** TC-021 needs a labeling failure to be induced on purpose
  (a locked or checked-out file), and TC-032 is blocked on the clarification above.

[INSERT reports/charts/05-automation-tracker.png]

The dashed line is a proposed ramp rather than a commitment, and it deliberately stops at 15: that is
everything automatable without taking on Purview portal automation. Getting beyond 15 is a scope
decision, not an effort question.

## 5. What we need from you

1. **TC-032:** confirm whether policy grading should be enabled here and what the accuracy panel is
   expected to show, so we can write pass criteria.
2. **The 7 TBC items:** confirm owners, and whether the 3 P1s (TC-008, TC-010, TC-011) should be
   cleared before we add more automation.
3. **Policy stability:** the automation deliberately never creates or modifies Purview policies, so
   it depends on the existing test policies staying enabled. Please confirm
   `SingleLocationScope-Enforcement`, `MultiLocationScope-Enforcement`, and the `OverrideLabel`
   policy are permanent fixtures in this tenant.
4. **Scope call on Tier 3:** is automating the Purview portal itself in scope? That single decision
   gates 25 of the 42 scenarios.
5. **Sheet versus tenant values:** align TC-003 on the tenant's SIT and label, or add the tenant
   policy as its own row.

Happy to walk through the automated run live, it takes under a minute.

Thanks,
<your name>

---

## Internal notes (delete before sending)

- Regenerate charts and the summary: `npm run report:build`. Output goes to `reports/charts/`,
  `reports/weekly-report.html`, and `reports/data/summary.json`.
- Update the tracker each week by appending one entry to `actuals` in
  `reports/data/automation-history.json`, then rebuilding.
- The build asserts that this draft still quotes the live numbers, so if a status changes in
  `reports/data/test-cases.json` the build fails until the wording here is updated.
- Status changes should be made in `reports/data/test-cases.json`, which mirrors the TestCases tab.
