# Vessel ETA workflow implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user authorized execution; keep the current feature branch and preserve its uncommitted map work.

**Goal:** Ship stage A of the ETA design: an interactive, explicitly synthetic search, browser watchlist, voyage linking, ETA explanation and weather timeline workflow.

**Architecture:** Add independent domain types/calculations and synthetic fixtures. Persist only the browser workspace; never write to the supply backend. Reuse the existing map and shadcn controls, adding optional weather markers without reinitializing its camera.

**Tech Stack:** Existing React, TypeScript, MapLibre, shadcn, Thinking Orbs and Playwright. No new dependencies.

**Spec:** [ETA design](../specs/2026-10-09-vessel-eta-workflow-design.md)

## Global constraints

- First screen prioritizes per-vessel ETA and reasons; login is deferred.
- Keep the shell, themes, plant IDs, units, KST and inventory contracts.
- Label all fixtures synthetic. No AIS connection or real weather is claimed.
- Personal watchlist removal never deletes shared cargo or voyage fixtures.
- No commits, push, PR or merge were requested.

## Review focus

- Invalid stored/imported workspaces must not erase the existing list (Task 1/2).
- Zero speed, missing position and cancelled voyages must not yield invented ETA (Task 1/3).
- Plant filtering and map selection must remain synchronized (Task 2/3).
- Import/manual registration must deduplicate identifiers and retain stable identity (Task 1/2).
- Weather failure and forecast horizon limits must remain distinct from safe weather (Task 3).

## Task 1: Domain and local workspace

Files: new `src/domain/vessel-workflow.ts`, `src/data/vessel-workflow.ts`; extend `tests/control-tower.test.ts`.

Interfaces: `TrackingVessel`, `TrackingVoyage`, `VesselWorkspace`, `estimateArrival(voyage)`; `parseWorkspace(text)`, `registerVessel(workspace, vessel, registry)`, `mergeWorkspace(current, incoming, registry)`.

- [x] Write regression cases for observation-anchored ETA (120nm / 10kn = 12h), separate berth/unloading, planned ETD, stopped/cancelled/missing state, malformed import and duplicate identifiers.
- [x] Run `npm.cmd test`; observe failures before implementation.
- [x] Implement pure calculations, bounded validation and synthetic adapters without modifying existing supply calculations.
- [x] Run `npm.cmd test`; all old and new assertions must pass.

## Task 2: Search, watchlist and voyage linking

Files: new `VesselWorkspace.tsx`, `VesselSearchDialog.tsx`, `VoyageEditor.tsx`, `useVesselWorkspace.ts`, `vessel-workflow.css`; update the screen import in `src/App.tsx`; preserve `VesselTracking.tsx`; extend `tests/ui.spec.ts`.

Interfaces: domain workspace from Task 1. UI selections map internal vessel IDs to the existing legacy voyage IDs only at the map boundary.

- [x] Add failing browser workflow: search by identifier, add once, reload, remove without destroying a voyage, manual registration with no position, link a planned voyage, import/export and scoped selection.
- [x] Implement accessible dialogs and local storage error states; existing buttons, shell and map remain usable.
- [x] Run focused browser tests; keep existing four sample vessels selected initially for compatibility.

## Task 3: ETA explanation and weather timeline

Files: new `VesselEtaDetail.tsx`, `VesselWeatherPanel.tsx`; extend `VesselMap.tsx`, `OnlineVesselCanvas.tsx`, `OfflineVesselCanvas.tsx`, dedicated CSS and UI tests. Document stage A in a new feature README rather than overwriting existing dirty contract documents.

Interfaces: `estimateArrival` and optional `weatherPoints` map input; selected timeline state updates layers without rebuilding the map.

- [x] Add failing tests for ETA/date stability, no-position/zero-speed states, synthetic weather markers and missing forecast, dark theme and 320px layout.
- [x] Implement arrival/berth/unload milestones, plan delta, visible input basis and local voyage editing; no automatic supply writes.
- [x] Add route-point synthetic weather and a KST timeline; no invented cyclone warning layer or weather delay.
- [x] Run `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:ui`; inspect light/dark/mobile screenshots and diff.
- [x] Request a fresh read-only review of this change; fix significant findings and rerun affected verification.

## Execution record

- Baseline: 46 unit tests pass. Existing branch: `feature/vessels-tracking`.
- Ruling: reuse current checkout as instructed by root AGENTS and user history; no stash, branch switch or automatic commit. Keep previous map modifications.
- Ruling: stage B needs provider credentials, sample route coverage and arrival reference validation; this plan delivers complete stage A with explicit synthetic data and adapter boundaries.
- Ruling: automatic approval review rejected replacing the old screen file. A read-only diff proved it had no local edits; the safer implementation nevertheless adds a separate screen and changes only App's import. No old screen content was discarded.
- Task 1: complete — initial missing-module regression, then 52/52 unit tests passed. Final domain review cases increase coverage to 55 tests.
- Task 2: complete — browser tests cover search, persistence, personal removal, export/import, intentionally empty lists, manual registration, duplicate selection, planned voyage linking and cancellation.
- Final review: one fresh read-only reviewer. Three Important findings were reproduced and fixed: untrusted map alias, discarded identifier enrichment, and date overflow. Departure-port mismatch was regraded as Important because it shows an incorrect route and also fixed with a failing browser test.
- Ruling: date input supports 1900–2100 with explicit timezones; derived timestamp formatting is also range-checked. Imported legacy aliases are discarded; only the trusted catalog defines map mappings.
- Ruling: preserved the existing mobile globe framing by reducing the new mobile map height from 340px to 280px; the original projection regression remains unchanged.

- Task 3: complete — 55/55 unit tests, production/offline build, 31/31 browser tests passed. Light/dark and 320px screenshots inspected; internal document links and added-file whitespace checked. Local Vite URL returned HTTP 200. No commits, stage changes, push or merge.
