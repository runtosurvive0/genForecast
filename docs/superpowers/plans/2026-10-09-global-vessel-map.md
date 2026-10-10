# Global vessel map implementation plan

> Execute inline using superpowers:executing-plans. Preserve the existing vessel branch and uncommitted dot work. No commit or push requested.

**Goal:** World dots morph into a detailed worldwide vector map while vessel selection, attribution, and offline use remain reliable.
**Architecture:** MapLibre owns the online camera and all geographical layers. Existing SVG is the offline/error canvas; the parent owns the shared vessel panel and selection.
**Tech Stack:** React, TypeScript, MapLibre GL JS, OpenFreeMap, Playwright, Node tests.
**Spec:** ../specs/2026-10-09-global-vessel-map-design.md

## Global constraints

- Keep current layout, data contracts, sample AIS labels, light/dark, and keyboard selection.
- Morph at MapLibre zoom 4–6; max zoom 18. Attribution 10px, light #646464, readable dark grey.
- New assets before imports; package and lock together; no external script CDN.
- User AGENTS says approved work proceeds without repeated confirmation. Execute this approved scope inline.

## Review focus

- Dateline crossings: preserve short route and vessel alignment across repeated worlds.
- Failed style/tile loads: keep local geography, show status, allow explicit retry.
- Rerenders/theme changes: preserve camera, selection, and cleanup WebGL resources.
- Narrow screens: attribution readable with no control overlap; fixed-size markers.
- Offline file export: no online worker dependency; existing SVG remains functional.

## Task 1: Map data and renderer boundary

- [x] Add `tests/vessel-map.test.ts` for shortest longitude unwrap, invalid positions, morph endpoints; observe failures.
- [x] Create `src/features/vessels/map-data.ts` with shared sample routes and `unwrapRoute`, `morphProgress`, `validPosition`.
- [x] Extract existing canvas to `OfflineVesselCanvas.tsx` preserving its controls and SVG behavior.
- [x] Install maplibre-gl and add its test file to npm test. Verify unit tests.

## Task 2: Online map and integration

- [x] Add deterministic online style fixture tests to `tests/ui.spec.ts`, using the real engine; observe absent-canvas failure.
- [x] Create `map-style.ts` for style colors, layer fades, dot/route sources, and compact attribution.
- [x] Create `OnlineVesselCanvas.tsx`: inline Vite worker, initialization/cleanup, camera, markers, controls, failure handling.
- [x] Wire through VesselMap without changing its public input contract. Add loading/fallback/retry status.
- [x] Keep dot background until detailed tiles load. Theme updates preserve the camera and source attribution.
- [x] Check online zoom/reverse, selected marker, 200 positions, keyboard, reentry and failure/retry.

## Task 3: Style, documentation and acceptance

- [x] Add scoped MapLibre styles in vessel-map.css; 10px attribution with theme color and no control overlap.
- [x] Route old SVG tests explicitly through network-failure/file fallback; retain their assertions.
- [x] Update THIRD_PARTY_NOTICES.md and DATA_DICTIONARY map mode notes.
- [x] Run npm ci, npm test, npm run build, npm run test:ui and git diff --check.
- [x] Inspect real tiles at Dangjin, Newcastle, an Indonesian supply port and Rotterdam; capture desktop/mobile light/dark.
- [x] Fresh review, meaningful regression fixes if needed, final status. No commit/push/merge.

## Execution ledger

- Initial: base bd401d6; branch feature/vessels-tracking. Prior local dot changes are this session's work and remain intact.
- Ruling: execute inline in the user's existing feature checkout; no parallel branch switching or implementation agents.
- Ruling: user explicitly approved execution and instructed no repeated per-stage permission; proceed without another plan gate.

- Implementation: MapLibre 6.13.0 with an inline worker, zoom 4–6 blend, max zoom 18, compact 10px credits, and local SVG fallback.
- Verification: npm ci succeeded after stopping the project Vite process to release its Windows native-module lock; Vite restarted hidden at 127.0.0.1:5173. npm test: 37/37; npm run build: success; npm run test:ui: 18/18; git diff --check: clean.
- Review: corrected readiness for later provider requests and added a failing-then-passing regression covering loading, source failure, and retry. The reported mobile minzoom issue was disproved against MapLibre source and a live 390px check (zoom -0.557, 8,969 rendered dots); this is now a browser assertion.
- Failure handling adjustment: any map tile error explicitly switches to local geography with a retry action, rather than leaving partially missing detail with a permanently latched warning. Selection survives; retry resets the camera to world view.
- Scope: common WorldMap UI, generated geography, dependencies and data documentation changed; include these in a future integration review. No commit, push or PR performed.
- Remaining: npm audit reports three existing high build-chain findings (braces/micromatch/vite-plugin-singlefile); no force downgrade applied. Online detail requires a network connection; source coverage varies, and AIS remains sample data.

- Visual evidence: real OpenFreeMap detail verified at Dangjin, Newcastle, an Indonesian sample supply location and Rotterdam; desktop light and mobile dark captures reviewed under .tooling-tmp/. The Indonesian sample point is an illustrative inland location, not a verified terminal berth.
- Final performance fix: guarded unchanged global-state writes after observing an idle→update→idle render loop. The new map.loaded() assertion failed before the fix and passed after it. Dark symbol colors were adjusted for legibility.

- Existing UI test timing: a full rerun caught an immediate innerText comparison before the model navigation repaint settled; its isolated rerun passed. Retained the exact changed-value assertion and changed it to Playwright expect.poll so it waits for the UI update. No model code or expectations were removed.
- Distribution notice: retained the full MapLibre package license and upstream notices in THIRD_PARTY_NOTICES.md.

## User feedback revision (2026-10-09)

- Supersedes initial readiness design: latch the first successful provider load; normal tile fetches no longer reset morph to zero. Post-ready source failures retain the map and expose refreshTiles retry. Initial connection or WebGL failure still uses SVG fallback.
- Default native globe with a flat switch, short-side home framing, responsive overview resize, hidden back-side markers, projection preserved through theme changes. Controls animate zoom respecting reduced motion.
- Dot radius now grows with zoom before the 4.75–6.25 land blend; dots are below the water layer so coast edges stay clipped.
- Separate flat grids generated at widths 260/460/820 in ellipsoidal WGS84 Mercator with exact inverse coordinates: 15,905 / 49,809 / 157,927 points. Globe/offline grids remain unchanged. Regression compares northern vs equatorial projected row spacing (within 2%).
- New regressions cover projection switching and theme persistence, dot radius growth, loaded-tile stability, vector tile retry without camera reset, and mobile globe reframing.
- Real render check: delayed four new provider requests by 700ms and sampled every render; morph remained 1. Desktop/mobile globe, flat high-latitude grid, and blended coastline images inspected.
- Verification: npm test 38/38; build success. UI timeout was reproduced without the live QA browser. Trace isolated returned Map objects from Playwright evaluate mutations: ~86MB serialized per call, 11s protocol time, versus 27-byte undefined in ~3ms for no-return blocks. Removed the accidental return; assertions and timeout remain unchanged.

- Final verification: npm test 38/38, npm run build success, npm run test:ui 20/20 (56.5s), git diff --check clean. A later offline-test interruption was traced to a Vite page reload resetting navigation; the final unchanged-file run passed all tests. No timeouts or assertions weakened. No commit, push or PR.

## Gentle dot growth correction (2026-10-09)

- User rejected rapidly expanding, overlapping translucent circles. Replaced radius growth up to 44px with gradual 1.05–2px growth. Keep the existing 4.75–6.25 land fade; land appearance fills the gaps without forcing dots to touch.
- Updated the real-render regression to inspect evaluated radii at zoom 4, 4.75, 5.5 and 6.2: gradual growth, 2px cap, correct dots/morph modes. The old implementation failed at zoom 4 (radius 6.1px versus allowed growth 4.8px), before the fix.
- Visual check: real OpenFreeMap at zoom 3.5 / 4.75 / 5.5 / 6.25 showed radii 1.6 / 1.85 / 1.925 / 2px, with morph 0 / 0 / 0.5 / 1. Light flat, dark globe and dark mobile screenshots reviewed; no swollen translucent rings.
- Full UI run exposed an unrelated immediate mobile-width assertion in the MILP test (19 passed, 1 failed); it passed unchanged in isolation. TowerChart uses an asynchronous ResizeObserver. Replaced only that immediate assertion with expect.poll on the same no-overflow condition; no app behavior or test threshold changed.
- Trace confirmed the mobile resize race: chart widths changed from 723/361/607/477px to 246/254/246/246px about 24ms after the failed check. Final verification: npm test 38/38, npm run build success, npm run test:ui 20/20 (55.9s), git diff --check clean. Read-only review found no issues in the radius correction. Branch feature/vessels-tracking; no commit/push/PR.

## Vessel/route alignment correction (2026-10-09)

- Found two independent coordinates: markers consume current voyages/positions, while routes used legacy static waypoints and all four unused samples.position values differed. Zoom amplified the geographic mismatch.
- Online and offline now share routesForVessels using the current position as an exact route vertex. Removed stale duplicated positions; organized the four illustrative routes into before/after waypoints to avoid an artificial backtracking detour. Unknown vessels still receive no fabricated route. No AIS, ETA or stock contract changed.
- Real-render regression failed before the fix (ship-br missing its own route at globe zoom 3), then passed for all four vessels at zoom 3/6/12/18 in both views. Unit checks cover position updates, endpoints, duplicate arrival vertex, invalid/unknown input and input preservation.
- Visual verification: real OpenFreeMap zoomed vessel/route connections inspected in flat and globe views, plus dark mobile. Offline SVG marker-to-path alignment checked for all four ships at maximum zoom. Refined the Hadong surrounding example waypoints after inspecting an abrupt corner.
- Final verification: npm test 40/40; npm run build success; npm run test:ui 21/21; git diff --check clean. Read-only review found no important defects. Kept feature/vessels-tracking; no staging, commit, push or PR.

## Transparent top-left attribution (2026-10-09)

- User requested no white/dark backing box and placement at the map frame top-left. Moved the native attribution control, made both themes transparent, retained the 10px text and all source links. Reserve room for the top-right view switch; status/retry messages sit above the bottom controls.
- Updated the existing attribution regression for transparency, top-left placement and mobile link hit-testing without opening external pages. Initial test failed on the old opaque background as expected.
- Verification: npm test 40/40, build success, npm run test:ui 21/21, git diff --check clean. Actual 1440px and 320px light/dark OpenFreeMap captures inspected. At 320px, credits keep 16.7px clearance from the view switch and 74px from an induced tile-error status; every source link passes trial hit-testing. Branch feature/vessels-tracking, no commit/push/PR.

## Map toolbar, scale and starfield (2026-10-09)

- Removed the obsolete 48px bottom reservation for attribution. Hint now sits 8px from the bottom/left; zoom/reset precede the view switch in a top-right toolbar. Narrow map containers place the toolbar beneath attribution. Added native metric ScaleControl at bottom-right with a center-scale tooltip and projection-transition updates.
- Added GlobeStars canvas and pure globe-stars projection math. Seeded 1–1.4px squares follow camera orientation, stay beyond the globe silhouette, and hide in light/flat modes. No dependencies, independent animation loop, or state/repaint writes from drawing.
- RED: new toolbar/scale and star behavior UI tests failed before implementation. GREEN: both pass, including actual drag and deterministic return. Updated the existing map canvas locator to distinguish geography from the decorative canvas.
- Real OpenFreeMap views inspected on desktop and 320px mobile, light/dark/globe/flat. Geographical projection roundtrip checks at latitudes 0, 15, -30, 60 and 85 found zero stars on the globe; the initial view shows about 50 faint stars.
- Final verification: npm test 43/43, npm run build success, npm run test:ui 23/23, git diff --check clean. The browser regression checks actual star pixels against MapLibre geographic roundtrips, confirms drag/return determinism, flat/light hiding and idle completion. Read-only review found no important defects. No new dependency; feature/vessels-tracking retained; no commit/push/PR.


## Continuous dot growth and zoom detail (2026-10-09)

- Light overview dots darkened from #bdbdc3 to #a9a9b2. A faint native land backdrop begins at zoom 1.5 so the coast stays recognizable while detail changes.
- Every circle layer shares one continuous radius curve through fractional and integer zoom: 1.05 + 0.37 × clamp(zoom, 0, 6.25). At zoom 4.75, radius is ~2.81px (previously 1.85px); maximum diameter stays below the 8px native detail spacing.
- Local vector tiles supply detailed dot grids only for the visible map. Parent coordinates persist in child tiles; newly inserted points fade in over 0.7 zoom. Seven reusable tile templates cover zoom 0–6 and are copied before worker transfer. No remote dot service or new large point dataset.
- Directly declare the already-transitive @maplibre/vt-pbf 4.3.2 dependency for supported vector encoding. package.json/package-lock.json and third-party notice updated; flag dependency changes for integration review.
- Unit regressions cover continuous radius, separation, nested point preservation and transfer-safe cache. UI regression inspects actual rendered points and radii across integer boundaries, animation, themes and projection changes.
- Animation regression caught the default global-state paint transition lag. Radius now uses a native top-level zoom expression, and camera-driven style blending has no extra time delay. The original strict per-frame radius assertion passes.
- Actual OpenFreeMap QA: light/dark, globe/flat and 390px mobile inspected. A 1.8-second zoom sequence produced 108 frames, maximum sampled land brightness change 0.84/255 and no detail reset; no browser/map errors or mobile page overflow.
- Final verification: npm test 46/46, npm run build success, npm run test:ui 23/23; formatting and git diff --check clean. Reviewed source/cache lifecycle, evaluated radius and staging state. Branch feature/vessels-tracking retained; no stage/commit/push/PR.
