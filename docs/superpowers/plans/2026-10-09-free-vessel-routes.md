# Free vessel routes and collected tracks

Approved scope: real watchlist positions; confirmed destination; free estimated sea route; observed track persistence; bounded refresh without camera resets. No weather ETA changes or paid APIs.

## Constraints and decisions
- Continue the existing dirty `feature/vessels-tracking` checkout; preserve previous work. No commit/push requested.
- Shipments/operations ledger contracts stay unchanged. The map receives a vessel-specific display adapter with optional cargo metadata.
- Destination is explicitly selected from existing plant ports; AIS text is a hint, never automatic confirmation. Port coordinates are approximate and the route is a visualization estimate, not a berth-level navigation plan.
- SQLite under ignored `backend/data/` stores only registered real MMSIs and collected observations. Browser owner token scopes tracking membership; union of active owners drives collection. Deleting interest disables that owner's tracking, not historical records.
- AISstream background collection starts at backend startup for persisted interests; Digitraffic uses its cached public snapshots. No historical backfill claims. Track retention 30 days; discontinuities >6 hours or implausible jumps are not joined.
- searoute is a backend dependency, Apache-2.0; update pyproject, lock and third-party notices. Estimated geometry remains separate from observations, and endpoint snapping is disclosed instead of inventing an observed connector.

## Tasks
1. Backend: persistent tracking membership/observations, AIS ingestion hook, snapshot polling independent of discovery eviction; estimated route cache with explicit destination and bounded inputs. Test SQLite restart, dedupe, owner isolation, gaps, stale data and real route geometry.
2. Frontend: actual vessels map adapter and shared typed routes for online/offline maps; confirmed destination control and request hook; keep last successful data on transport failure but never display a route for a different vessel/destination. Test state and UI.
3. Verification: Python suite, npm test/build/UI, offline/online light/dark/mobile screenshots, runtime endpoint smoke check; independent final review. Update docs with restart instructions and limits.

## Review focus
Actual vs synthetic provenance, no fake endpoints/ETA, stale requests on selection/destination changes, sample compatibility, persistence after restart, large global stream avoiding per-message disk I/O, SSRF/input validation, route snapping, dateline and observation gaps, no user-key exposure.

## Progress
- Pre-flight: backend returns vessel snapshots and route/track GeoJSON; frontend consumes the same lon/lat coordinates and UTC observed timestamps. KST formatting stays in UI.
- Ruling: reuse current branch and keep changes uncommitted because the user authorized implementation only; moving checkout would lose the active development context.
- Backend complete: searoute 1.6.0 + SQLite tracking; registration and AIS ingestion survive restart. Positions sampled at >=60 seconds, flushed every 5 seconds, retained 30 days. API requires an explicit destination and accepts validated 24/168/720-hour queries.
- Frontend complete: actual AIS markers without fabricated shipments; confirmed destination, selected-vessel estimate and observed segments in both map renderers. Destination storage is separate from voyage/cargo/ETA assumptions. Polling retains camera and same-key successful data on failure.
- Independent review (`navigation_review`) resolved: integer Literal query caused HTTP 422; fresh polling used a frozen display clock; sample-ID collisions could borrow a synthetic route; failed refresh erased the last estimate. Regression tests reproduced each failure before fixes.
- Validation so far: Python suite 68 passed; frontend unit suite 61 passed; production build passed. Offline/online light/dark/mobile rendering inspected, including dashed estimates vs solid observations and camera preservation.
- User restarted the key-bearing server. Live smoke test: AISstream receiving (2,000 cached vessels), Newcastle-area estimate to Dangjin returned 4,806.71 nm / 42 coordinates. Separate browser registered one received vessel temporarily, rendered its actual position and estimated route with real OpenFreeMap, and retrieved one stored observation. Test membership was removed afterward; no credentials copied.
- UI full run initially 43/44: the pre-existing MILP catch-all API fixture incorrectly treated a tracking request as a planning query. Scoped that fixture via fallback and isolated tracking fixtures from the live collector.
- Final UI verification: the corrected full run passed 43/44, including MILP and all new navigation tests. The remaining mobile overview test was interrupted by a Vite page reload while this plan was saved (two navigation/connection sequences in trace). Re-ran only that test with no file writes: 1/1 passed in 3 seconds. All 44 scenarios have passed; do not describe this as a single uninterrupted 44/44 run. Preserved trace at ignored `.tooling-tmp/mobile-reload-trace.zip`.
- Final checks: `git diff --check` clean (line-ending normalization warnings only), staged diff empty, `pip check` reports no broken requirements. Local DB and smoke-test artifacts are Git-ignored. No commit, push, PR or merge performed. Tasks 1–3 complete.

## Follow-up: directional symbols and route attachment

- User approved the light/dark hull design. Added COG-based symbols, neutral dots for missing motion / <0.5 kn / moored/anchored states, a selected outline and fixed upright labels. Shared projected tangent handles globe rotation, offline Equal Earth and dateline seams. No backend/dependency changes. Initial icon verification: 63 unit tests, build and all 46 UI tests passed.
- User then reported a gap between vessels and routes at high zoom. Reproduced with the actual server: input `[125,35]`, route start `[125.57373,34.152727]`, offset 58.24 nm. This is network snapping, compounded by cached route origins and sampled track endpoints; moving markers to route nodes would falsify AIS.
- Updated the initial no-connector display decision: a separately typed/drawn `connector` is a position guide, explicitly not an observed or navigable route, and excluded from distance/ETA. It always starts at the current AIS coordinate. Calculated network geometry is unchanged. Existing observed tracks may extend only to a real newer AIS observation within the same gap/jump bounds.
- Regression checks: original coordinates and cached geometry remain unchanged, guides follow new fixes, gaps/jumps are not bridged. Browser checks cover zoom 3/12/18 in globe and flat modes plus offline zoom, including rendered line intersections with the marker center. Very short tracks are subpixel/tile-simplified at overview zoom; detailed zooms verify observed-line alignment. Both new alignment UI cases pass.
- Final combined verification: `npm.cmd test` 65/65 passed, `npm.cmd run build` passed, `npm.cmd run test:ui` 48/48 passed in one uninterrupted run (2.2 minutes); `git diff --check` clean and staged diff empty. Inspected online/offline light/dark symbols and the route-guide screenshot. Branch remains `feature/vessels-tracking`; no commit/push/PR. No backend restart required for these follow-ups.
- Limits: no pre-collection history, ship-confirmed plan, berth-level routing, weather-aware ETA or login. API fees are not introduced; PC/server must remain running for collection. SQLite and smoke artifacts are ignored. Common map/dependency edits require integration review when a PR is requested.
