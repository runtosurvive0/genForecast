# gen4cast 운영 시안 앱 통합 Implementation Plan

> For agentic workers: use isolated worktrees and implement the independent transport, shared 3D scene, and dashboard components against the interfaces below. Parent integrates the app shell and verifies all results. Do not commit, push or merge.

**Goal:** 합의한 전체 메뉴 시안을 실제 React 앱에 통합하고 기존 로그인, ZGX 조회, 재고 원장·계획 기능을 유지한다.

**Architecture:** 시안의 재사용 3D 모델을 Vite 모듈로 옮기고 React가 화면·선택·연결 상태와 수명주기를 소유한다. 공통 운영 패널과 해시 경로를 App에서 연결한다. 기존 DB 수급과 사진 기반 운전 데모는 명시적 출처 전환으로 구분한다.

**Tech Stack:** 기존 React/TypeScript/Vite, lucide-react, Three.js 0.187.0, ws 8.22.0(로컬 모사 서버).

**Spec:** 이 문서의 확정 디자인 및 데이터 경계. 사용자와 완성한 61577 시안 및 대화의 최신 수정사항이 시각 기준이다.

## 확정 디자인과 범위

- 로고 gen4cast, Newsreader Medium, 기존 심볼. 회색 바탕·파란 고정 운영 패널·흰 콘텐츠 패널, 다크모드는 짙은 회색.
- 1920×1080에서 두 운영 화면 전체를 한 페이지에 표시. 좁은 화면은 내용 접근성을 유지하고 자연스럽게 세로 배치한다.
- 패널 상단 발전 출력·총재고·접안 지표, 하단 항차/접안/저탄/상탄/호기 단계와 실제 메뉴 연결.
- 접안은 선박 다각도보다 부두별 실제 접근 가능한 컨베이어·분기 설비·저탄장 흐름을 중심으로 표시.
- 저탄장은 1/2/3 선택, 지붕 투시, 확대·이동, 설비 hover 텍스트, 더미 선택과 상세/표를 유지.
- 상부 이격은 박스 없는 12px 치수 텍스트와 1px 선. 미달만 빨간색, 미확인 위치는 판단하지 않음.
- 1저탄장 오른쪽 사용 제한은 기존 사진 재고 위에 겹쳐 표시. 2저탄장은 Pile별 환산 폭·높이·720m 종단축. 3저탄장은 기존 개념 형상을 유지하며 미제공 이격 기준을 만들지 않음.
- 데모 WebSocket 연결 시 운전 설비·흐름·낙탄·더미 성장을 같은 수신 스냅샷으로 표시. 연결 끊김은 마지막 값/애니메이션 정지.
- 사용자 추가 승인: 나머지 모든 메뉴도 같은 디자인으로 적용. 항차·화물, 상탄·혼탄, 호기·연소, 통합 시뮬레이션, 구매 검토, 계획·실적 분석, 데이터, 연결·수집, 사용자·권한을 기존 기능과 연결하며 이 작업에서 가짜 완료 상태나 새로운 사실을 만들지 않음.

## Global Constraints

- 사용자 원본 checkout의 DB/PPT/기존 작업 보존. codex/gen4cast-ui-integration 작업 브랜치.
- AuthGate, 계정별 AIS, /api ZGX 프록시, plant_id/stockpile_id/t/kcal/kg/KST 계약 보존.
- DB 집계 수치를 사진 Pile로 임의 배분하지 않는다. 계획 조회와 데모 물리 재고를 섞지 않는다.
- 모사 서버/조작반은 실제 ZGX에 쓰지 않는다. 테스트는 임시 서버 또는 HTTP mock 사용.
- 공통 표현은 src/components/, 공통 계산·타입은 src/domain/, 참고 데모는 src/data/. 화면끼리 직접 import하지 않음.
- 시안에 있는 사진 재고는 참고 데모 출처로 표시하며 사진 원본·로그·세션·작업 DB는 가져오지 않음. 공개 저장소에 commit/push하지 않음.
- 원본 시안 서버 61577/61578의 사용자 상태는 보존. 새 의존성은 package.json/lock 함께 기록.

## Review Focus

1. 서버 미연결/재시작: 유효하지 않은 값이나 계속 흐르는 애니메이션 금지, 새로운 serverId 수용.
2. React StrictMode/페이지 전환: 소켓·requestAnimationFrame·WebGL 자원·이벤트 리스너 해제.
3. DB API 실패/자료 누락: 표본으로 자동 대체하지 않고 미확정/재시도 유지.
4. 1920/1131/390/320 폭·다크·키보드: 잘림/겹침 없이 선택·상세·메뉴·조작 접근.
5. 접안 경로/1저탄장 제한/미확인 이격: 기존 source-defined 규칙 유지.

## Task 1 — Shared model and React scene

**Files:** src/components/fuel-scene/*, src/data/fuel-reference/*, src/domain/fuel-reference.ts, tests/fuel-reference.test.ts.
**Interface:** FuelScene props: mode ('yard'|'berth'), yard (1|2|3), berth (1|2|3), theme ('light'|'dark'), selectedLotId (string|null), onSelectLot(id), snapshot (unknown|null), online (boolean).
**Data:** export referenceLots, referenceYards, referenceEquipment and helpers from src/domain/fuel-reference.ts; typed source IDs and photo source retained.
- [x] Test stock totals, reachability, zero heaps and clearance model before adapter changes.
- [x] Port verified mesh/flow/calibration with ES imports and no window globals or separate HTML/iframe.
- [x] Implement mounting/cleanup, camera controls, roof cutaway, pointer/keyboard selection, small dimension overlay.
- [x] Verify same source material totals and no resource leaks on route changes.

## Task 2 — Explicit demo transport and control page

**Files:** src/domain/fuel-demo/*, src/components/fuel-demo/*, scripts/fuel-demo/*, tests/fuel-demo.test.*.
**Interface:** FuelDemoProvider enabled/children; useFuelDemo() returns status ('disabled'|'connecting'|'online'|'stale'|'disconnected'), snapshot, catalog, receivedAt, command(), serverId. FuelDemoControl renders operational controls.
- [x] Test disconnected/stale/restart/dedup and two real client round-trip.
- [x] Adapt verified local demo engine, one source of truth; no operational API writes.
- [x] Resolve same-origin /demo-stream WS endpoint. Connection only when explicitly enabled; correct cleanup; no silent command replay.
- [x] Build compact accessible control page with play/pause/speed/preset, equipment/unit edits, schedule and errors.
- [x] Add exact package/script/proxy requirements to handoff; parent owns package and Vite.

## Task 3 — Two native dashboard screens

**Files:** src/features/stockyard/OperationsYard.tsx, operations-yard.css; src/features/berth/OperationsBerth.tsx, operations-berth.css.
**Interface:** both take theme, demo snapshot/status, onOpenLedger()/onNavigate(page); consume FuelScene and reference data through common imports. Explicit reference source when demo disabled. No global window state.
- [x] Implement accepted compact layout, connected selected inventory/table/side details and real route choices.
- [x] Include 1/2/3 yards and 3 berths; unknown and restriction states are visible.
- [x] Keep controls meaningful and preserve existing inventory/forecast entry via callbacks.
- [x] Verify desktop one-page and mobile reading order.

## Task 4 — App integration and validation

**Files:** src/App.tsx, src/components/operations-shell/*, package manifests, vite.config.ts, docs, tests/ui/*.
- [x] Add hash routes, gen4cast brand/header, fixed operating panel and existing navigation mappings.
- [x] Preserve AuthGate and existing planning query state; keep ledger/forecast view accessible. Select demo explicitly.
- [x] Add same-origin development WS proxy and standalone npm run demo command; default team dev still frontend-only.
- [x] Run npm test, npm run build, npm run test:ui plus new scene/transport UI checks with isolated data.
- [x] Inspect real 1920/1131/390/320 and dark captures. Review and document actual limitations. No commit/push/PR/deploy unless requested.

Baseline: latest origin/main 67ab2a3, npm ci complete; 145 unit tests and build pass before implementation.

## 완료 검증 기록 — 2026-11-05

- 단위 테스트 181개 통과, TypeScript 검사와 프로덕션 빌드 통과.
- 로그인 복원·첫 수신 대기 회귀를 포함한 전체 UI 95개 실행: 94개 통과, 지도 다크모드 캡처 1개에서 페이지 재로드로 실행 컨텍스트가 사라져 실패. 같은 항목을 코드 변경 없이 단독 재실행하여 통과(1개, 8.7초). 전체 95개가 한 실행에서 모두 통과한 결과는 아니다. 실제 격리 인증 서버의 회원가입·승인·로그인·계정 격리와 복원 로그인 4개 화면 폭 검사는 전체 실행에서 통과.
- 독립 WebSocket 조작반 실기 검증 통과: 명시적 연결, StrictMode 정리, 재생/정지, 설비/호기 변경, 스케줄 취소, 하역 물량 보존, 연결 해제, 4개 화면 폭·다크모드.
- 새 앱 5173/모사 61579, 기존 시안 61577/61578 동시 유지. 공용 ZGX 테스트 쓰기 없음.
- Impeccable 재검토의 여섯 수정 항목 모두 resolved, 해당 항목 범위 disposition ship. 디자인 문서의 실제 토큰을 별도로 기록한다.
- 최근 로그인 디자인은 보존된 w/genforecast-spectrum2 작업본에서 복원. 별도 복원 검토에서 원본 레이아웃·인증 콜백 유지와 1920/1131/390/320·다크 캡처를 확인, disposition ship.
- commit/push/PR/배포 없음. 기준 웹앱 67ab2a3와 원본 checkout의 사용자 변경 보존.
