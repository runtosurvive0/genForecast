Plan: docs/superpowers/plans/2026-11-08-coal-generation-integration.md

## Current slice: forecast main workspace
- Scope: DB-loaded conditions, minimal period inputs, save/run/status/result in the existing main screen.
- Preserve existing dirty working tree and existing calculation/data contracts. No shared-server writes in tests.
- Implementation choice: compose the data editor through App into the common planning workspace. Keep advanced editing and legacy data tools accessible.
- Implemented: DB conditions auto-load, period editor, save/run/poll/result flow, retained advanced inputs, and recoverable error handling.
- Implemented: primary forecast summary and chart, expandable yard/fuel/outage/calculation sections. When inventory series is unavailable, show the saved generation series and keep inventory unknown.
- Verified: 214 unit tests, build, four forecast input UI tests, and two focused results/integration UI tests passed. Light/dark and 1024px overflow checks are included in the focused results test. Actual ZGX-backed overview visually checked read-only.
- Full UI suite is not clean: earlier full run had 146 passes and six failures; fixes to some legacy selectors have not all been rerun. Do not report the entire suite as passing.
- Actual selected 2027 plan lacks inventory forecast values; current UI explicitly retains that missing state. Shared-server calculation was not executed for verification.
- The remaining integrated coal optimization tasks are not completed by this slice.

## Next slice: starting inventory within forecast results
- Added ForecastStockConditions.tsx and its scoped stylesheet, composed by PlanningWorkspace. Uses the existing run-scoped initial-stock API; no backend contract or operating-ledger writes changed.
- Admins enter high/low tonnes for each yard and two common calorific values at the selected plan's start date. No stock or calorific values are fabricated. Existing saved conditions are read-only because the current API supports initial registration only.
- Save refreshes the same run. Failed requests preserve input; duplicate-registration conflicts load saved conditions instead of overwriting. Concurrent submissions, timeout and unmount are handled.
- Regression exercised the exact request, failed-save retry, saved totals and refreshed forecast. Light/dark screenshots reviewed and 1024px horizontal overflow checked.
- Fresh verification: 214 unit tests passed; production build passed; existing isolated backend initial-stock regression passed (1 passed, 7 deselected). Sandbox-only unit run stalled on socket tests; elevated full rerun passed. Pytest temporary-directory permission failure was resolved with a workspace basetemp.
- Fresh independent code review found no important defects. Impeccable detector reported three advisory type-scale exceptions (15/16px); retained for numeric/input readability after visual inspection.
- Full UI regression exposed stale selectors for collapsed forecast details. Updated checks to expand those sections and verify calculation-source wording at its single top-level location, retaining the numeric/source assertions.
- No shared ZGX data was changed in verification; this build has not been uploaded to the separate /preview snapshot. No commit or push performed.
- Final UI verification: full suite completed with 147 passed / 7 failed. Four forecast tests were updated to follow the lazy detail disclosures (and reopen them after a period refresh); all four passed on targeted reruns. Numeric and data-source assertions were retained. Three known earlier failures remain: receipt-plan save/reopen, berth satellite layout, and vessel-shell source label. No claim of a fully passing UI suite.
- This slice is implemented locally only. Saved starting conditions remain read-only under the current API. No ZGX preview deployment, public DB mutation, commit, or push was performed.
