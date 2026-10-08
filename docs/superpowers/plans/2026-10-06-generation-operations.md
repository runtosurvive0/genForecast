# Generation Operations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent domain/orb work with root integration and final review.

**Goal:** 발전가능량과 정지예정을 중심으로 기존 대시보드의 UI와 동작을 개선한다.
**Architecture:** React UI + shadcn primitives, pure typed calculation engine with hourly inventory simulation, inline web worker for pending calculation, single-file offline build.
**Tech Stack:** TypeScript, React, Vite, Tailwind, shadcn/ui, thinking-orbs, Node tests, Playwright.
**Spec:** ../specs/2026-10-06-generation-operations-design.md

## Global Constraints
- 기존 top 60px / sidebar 184px 배치 유지. 원본 보존. 운영자료는 샘플 표시.
- 연료예측과 계획정지를 별도 표시. 모든 숫자 공통 모델 사용.
- 실재 공식 Orbs 및 shadcn 컴포넌트, light/dark, responsive, reduced motion.

## Review Focus
- 입항량이 하역완료 전 재고에 포함되지 않아야 한다.
- 정지 기간 중 소비가 0이고 재가동 후 다시 소비되어야 한다.
- 0 재고/0 부하에서 NaN/음수/가짜 정지일이 없어야 한다.
- 테마 저장 실패나 worker 불가에도 화면이 동작해야 한다.
- 모바일 dialog/tab/표/차트가 가로 넘침 없이 키보드로 동작해야 한다.

## Tasks
- [x] 1. `src/domain/operations.ts`, `tests/operations.test.ts`: 공통 샘플/타입/계산을 테스트 우선 구현. 노드 테스트에서 환산, 계획정지, 입항, 연료부족 검증. Interface: BASE_TIME, plants, shipments, simulate, availableEnergyGwh, scenarioDefaults. 상세 export는 구현자가 root에 공유.
- [x] 2. `src/components/ProcessingOrb.tsx`: upstream ThinkingOrb를 theme/status/reduced-motion과 연결, 처리 중에만 표시. Interface: theme light|dark, state solving|searching|connecting, label, size 20|64 optional.
- [x] 3. `src/App.tsx`, `src/components/`, `src/index.css`: shell, 5개 메뉴 화면, 계산/일정/상세/시나리오/CSV 구현. 공식 shadcn registry 사용.
- [x] 4. `src/workers/forecast.worker.ts`, `scripts/export.mjs`, `vite.config.ts`: async 계산 및 단일 파일 배포.
- [x] 5. `tests/ui.spec.ts`: 테마 지속/메뉴/필터/시나리오/상세/모바일 확인, 두 테마 스크린샷. `npm test`, `npm run build`, `npm run test:ui` 통과 후 독립 검토.

## Execution notes
- 사용자 요청은 전략 수립 후 적용까지 승인한다. 진행 도중 중복 승인 질문 없이 구현한다.
- git이 없는 로컬 폴더이므로 worktree/commit 절차는 적용하지 않는다. 원본 HTML 유지가 복구 경계다.

## Final verification — 2026-10-06
- Calculation tests: 16 passed.
- Browser tests: 7 passed (desktop/tablet/320px phone, themes, scenarios, map, offline file).
- Type checking and production single-file build passed.
- Screenshot capture: no browser errors; mobile scroll width matches viewport.
- Independent review findings corrected and rereview closed.
