# SPEC v0.1 page update

**Goal:** Implement the page-facing POC requirements from `/SPEC.md` in the existing offline React application.
**Spec:** `../../../SPEC.md`
**Execution:** Inline implementation with domain tests, browser checks and final review.

## Decisions
- Preserve the explicitly chosen Linear visual direction, Aceternity dotted map, top bar/sidebar, light/dark and offline HTML. MapLibre is a recommended stack in SPEC, not a reason to remove the user's chosen map.
- This request updates the page. Add typed snake_case contracts and dummy adapters; do not imply that a FastAPI service, live AIS connection, private sensors, or a production ML service is running.
- Use real local baseline fitting against deterministic synthetic training/validation data, clearly labeled as POC. Carry predictions into generation/fuel/inventory, expose loss curves and calculated metrics. Python/XGBoost deployment remains an integration boundary.
- This directory has no Git metadata or remote. No main-branch edits, merges, pushes, or PRs are performed.

## Work
- [x] Contracts and dummy fixtures: stockpiles, cargo/voyages, AIS positions, generation/model runs; pile totals and cargo sums are authoritative.
- [x] Calculation tests: stock/quality weighted means, heat rate, forward-seven-day coverage, freshness boundaries, risk and ETA/demurrage, model metrics and generation linkage.
- [x] Plant summary: nine SPEC KPIs, stock/arrival/fuel charts, plant comparison and unit utilization, training summaries; keep outage schedule and scenario access.
- [x] Stockyard: flow, inventory-proportional pile view, risk colors, coal mix, age-risk scatter and full pile details including unavailable sensors.
- [x] Vessels: dotted world map, identifiers, coordinates/speed/course, freshness, cargo quality, ETA/berth/unload and delay/demurrage scenario.
- [x] Models/data: training controls, actual synthetic baseline results, explicit adapter status, contracts and consistency checks.
- [x] Validate: domain suite, responsive desktop/tablet/mobile, themes, stale AIS, selections, scenario/model changes, standalone offline HTML and screenshots.

## Review focus
No stock credited at arrival instead of discharge; no double-counted piles/cargo; no fake live positions or sensor readings; no hard-coded training metrics; no cross-plant inventory sharing; preserve separate planned stops and fuel shortages.

## Execution and final review ledger
- Initial calculation tests observed RED on missing modules, then GREEN. Existing discharge test now distinguishes after-horizon from inclusive horizon; an exact-end regression reconciles KPI/stock.
- Current output review: confirmed P2; added failing regression (916.5 MW vs observed 1260 MW with 30-iteration model), separated current observation from forecast profile, test GREEN. Current inventory days also reconciled between overview and existing tables.
- Final review scope ruling: retain AIS-ETA-plus-delay correction for this page POC; route-distance/SOG arrival prediction remains unimplemented and labeled in UI/data dictionary. Cost: this page cannot evaluate speed-based route ETA until a routing adapter is supplied.
- Backend/live AIS/production ML scope remains as stated above. Cost: page validates interface and calculation flows only, not end-to-end operational integration.
- Kept Aceternity map rather than switching to recommended MapLibre, per user's prior explicit design choice. Cost: a later detailed nautical map needs another renderer/adapter.
- No Git metadata: no branch, merge, push or PR performed. Files remain in the user's workspace.
- Validation before final fix: 27 domain + 10 browser tests passed, including 200 vessels, model linkage, dark/light/mobile, offline HTML. Final output regression increases domain count to 28. Final build/check results recorded in handoff.
- 90-day local projection measured at 10ms on this workstation (API server not present).
- No deferred minor review findings.

Final verification: domain 28/28, browser 10/10, TypeScript/Vite single-file build passed. Screenshots: overview/stockyard/vessels/models/data light+dark+mobile. Capture reported zero page errors and 390/390 mobile width. Offline artifact updated: 발전운영_대시보드.html.
