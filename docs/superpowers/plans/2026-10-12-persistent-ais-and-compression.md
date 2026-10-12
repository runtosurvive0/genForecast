# Persistent AIS catalog and compressed frontend

**Goal:** HP continuously collects AIS independently of browser activity, persists the latest discovery records, and serves a compressed login bundle.
**Approved scope:** User explicitly requested continuous server DB ingestion, immediate DB lookup, restart recovery, and first-page compression. Continue on `fix/vessels-route-gap`; preserve pre-existing changes and private databases. No automatic merge.
**Architecture:** One collector process; SQLite WAL discovery DB separate from account and track DBs. Upsert dirty records every five seconds and flush on orderly shutdown. Keep existing 40,000 general / 1,000 Korea candidate / 72-hour candidate retention semantics. HTTP catalog reads committed DB records; stale observation timestamps remain unchanged. A separate loopback ASGI static service compresses only the public frontend file; Tailscale `/api` stays on the authenticated backend.
**Stack:** Existing Python/SQLite/FastAPI/Starlette/Uvicorn, no new dependency.

## Tasks

- [x] Add failing persistence/lifecycle tests: restart with no users, metadata-only observations, bounded eviction, expired candidates, failed flush retry, no browser-triggered start.
- [x] Implement incremental discovery persistence, startup restore and collection, DB-backed catalog API; isolate test DBs.
- [x] Add static frontend tests for gzip, plain requests, HEAD, 404/private paths and missing file; implement compressed static ASGI service.
- [x] Update user-facing persistence descriptions and deployment instructions; prepare HP patch with checksums, backups and rollback.
- [x] Run backend tests, frontend tests/build/UI checks, diff review.
- [ ] Validate on HP via user-operated installer; report remote verification separately.

## Verification boundaries

No full AIS history for all 40,000 ships: latest metadata/position only; watchlist history remains in its existing DB. A hard crash can lose the last uncommitted five-second batch (longer if disk writes fail); orderly shutdown flushes it. No login/approval bypass. Static service cannot read arbitrary paths. New DB is ignored by Git. Source code cannot silently overwrite HP edits; deploy checks original hashes and saves rollback copies.

## Execution record

- Added user request: lower password minimum to 8 (maximum 128), across admin CLI, signup, change/recovery and browser validation. Existing passwords remain valid. Added 7/8/129 boundary coverage and actual 8-character browser signup.
- RED: initial six persistence/frontend tests failed for missing functionality; password test failed at the 15-character server rule. GREEN: targeted 19 tests and whole backend suite 166 passed. Frontend unit tests 121 and build passed.
- Existing branch and dirty source/private planning DB preserved; no commits, staging, push or merge performed.
- Fresh read-only review found no blocking defects and separately verified cancellation during a save followed by newer ingestion. Optional permanent concurrency test deferred; current failure/retry and lifecycle tests are present.
- Initial UI run: 70 passed, one interrupted by navigation while source was being edited. Re-run after final source changes required; do not suppress its result.
- Second full UI run: 70 passed; a different map test was interrupted by navigation while the deployment script was edited. The first failed test passed. With file edits stopped, the second failed test passed three consecutive runs. Neither assertion was weakened; a single uninterrupted 71-test run has not been obtained this turn.
- Synthetic 40,000-record local check: ingest/save 0.586s, DB query 0.254s, restore 0.280s; this is not an HP performance measurement. Frontend gzip level 6: 5,816,611 -> 1,405,712 bytes (75.8% reduction).
- Deployment script compiles; update archive contents and SHA256 verified, no databases/keys included. `git diff --check` passed; staging area remains empty.
- HP installation requires the user's authenticated terminal; local implementation/test success does not imply remote deployment.
