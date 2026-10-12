# 승인형 회원가입과 AIS 4만 척 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AIS 검색 한도를 40,000척으로 확대하고 관리자 승인 계정만 온라인 업무를 이용하게 한다.
**Architecture:** 기존 FastAPI에 SQLite 계정·세션·개인 workspace와 인증 middleware를 추가한다. React 진입점은 세션 확인 후 App을 마운트하며 서버 API가 권한을 독립 검증한다.
**Tech Stack:** React, FastAPI, SQLite, argon2-cffi, HttpOnly session cookie.
**Spec:** ../specs/2026-10-11-approved-access-and-api-secrets-design.md

## 이번 단계의 범위
- 사용자가 2026-10-11 구현 재개 지시. 기존 설계의 가입/승인/세션/개인 목록을 구현한다.
- 공용 API 키 암호화·재연결 관리 UI는 후속 단계. 기존 환경변수 키 사용은 유지한다.
- 이전 미커밋 항로·한국 주변 변경을 보존한다. 커밋/push/merge는 하지 않는다.
- 8~128자 비밀번호(2026-10-12 사용자 요청 반영), pending/active/rejected/suspended, 최초 관리자 CLI, 세션 12시간/유휴 60분.
- API 접근은 서버에서 제한한다. 테스트용 인증 해제 스위치를 만들지 않는다.
- 사용자 DB는 backend/data/access.sqlite3로 Git 제외. 기존 planning.sqlite3와 분리.
- 상단바/사이드바 유지, 라이트/다크·반응형, 승인 시 user 역할.

## Review Focus
- 미승인 사용자의 API 직접 호출 및 owner 위조 → backend 권한 회귀 테스트.
- 다른 계정의 관심 목록/늦은 응답 노출 → workspace revision 및 계정 전환 UI 테스트.
- 마지막 관리자 정지/역할 변경 경합 → DB transaction 및 세션 취소 테스트.
- 로그아웃·비밀번호 변경 뒤 기존 세션 재사용 → 만료/폐기 테스트.
- Origin/CSRF 누락, 과도한 로그인·가입 → 거절/속도 제한 테스트.

## Task 1: 40,000척
- [x] 기존 수용/초과/퇴출 테스트를 40,000으로 변경하고 실패 확인.
- [x] ais.py와 vessel-discovery.ts의 공통 한도를 변경.
- [x] 마지막 40,000번째 검색·20행 pagination 및 문서 검증.

## Task 2: 계정과 API 접근
Files: backend/src/midterm/auth/{store,cli}.py, web/auth_api.py, web/app.py, __main__.py, backend/tests/test_auth.py.
Interfaces: AccessStore, session cookie, /api/auth/*, /api/admin/users, /api/me/vessel-workspace.
- [x] 임시 DB로 회원가입 pending, 승인/정지, 중복 초기화, 비밀번호, CSRF, 소유권 테스트 실패 확인.
- [x] Argon2id·세션 hash·속도 제한·감사 이력·관리 CLI 구현.
- [x] 전체 API에 인증/역할/소유권 경계 적용. JSON 오류는 민감 입력을 포함하지 않는다.
- [x] 계정별 workspace optimistic revision 저장과 크기/필드 검증.
- [x] Python 회귀 검사. 기존 core DLL 차단 여부는 별도 보고.

## Task 3: 로그인·회원 관리·개인 목록
Files: src/features/auth/*, src/lib/{auth-client.ts,account-context.tsx}, main.tsx, App.tsx, vessels workspace/navigation hooks, tests/auth-ui.spec.ts.
- [x] 가입 완료/대기 로그인/관리자 승인/사용자 전환 UI 테스트.
- [x] 공통 인증 요청/세션 갱신·만료 처리와 승인형 AuthGate 구현.
- [x] App의 데이터/관리자에 회원 관리, 계정 메뉴/로그아웃 연결.
- [x] 서버 workspace 로딩 후 App 표시, revision 충돌 알림, 기존 익명 목록 선택 가져오기.
- [x] 기존 브라우저 자료는 삭제하지 않으며 계정별 자료는 localStorage에 저장하지 않는다.
- [x] 기존 화면 테스트는 승인된 세션 API fixture를 사용. 인증 자체는 별도 실제 API 테스트.

## Task 4: 검증·운영 안내
- [x] npm test, npm run build, npm run test:ui, Python 관련 테스트, git diff --check.
- [x] 라이트/다크·모바일 로그인/회원 관리 화면 확인.
- [x] 관리자 초기화·동일 origin·HTTPS·재시작·서버 이전·제한 사항 안내.
- [x] 코드 변경과 검증 결과를 보고하고 사용자 관리자 생성/서버 재시작 안내.

## 실행 결과 (2026-10-11)

- 브랜치 `fix/vessels-route-gap`, 기준 `3e1b258`. 커밋·push·PR·merge 없음. 이전 항로·한국 주변 검색 변경 보존.
- `npm.cmd test`: 121개 통과. `npm.cmd run build`: 성공.
- `npm.cmd run test:ui`: 71개 통과. 가입·승인·계정별 선박/항차 저장·두 탭 계정 전환·기존 브라우저 목록의 선택 가져오기를 실제 격리 인증 API로 검증했다. 라이트/다크/모바일 화면도 확인했다.
- Python 전체 `pytest -q`: 159개 통과. 최종 실행에서는 이전 Windows DLL 차단이 재현되지 않았다.
- `git diff --check`: 통과. staged 변경 없음.
- 공유 파일 검증은 `data/planning.sqlite3` 체크섬 불일치로 실패했다. 로컬 자료를 보존했으며 체크섬을 변경하거나 DB를 덮어쓰지 않았다. 향후 PR에 이 DB를 포함하지 않는다.
- 인증 코드 리뷰의 계정 전환 혼선, 추적 합집합 한도 초과 시 시작 실패, 계정 복원 후 수집 미재개를 수정하고 회귀 검증했다. 재검토에서 추가 Critical/Important 지적 없음.
- 기존 HTTP/화면 테스트는 인증된 격리 계정으로 갱신했다. UI의 미지정 API는 로컬 운영 서버로 전달하지 않는다. Python API 테스트도 임시 계정·항적·원장 DB를 사용한다.
- 통합 리뷰 범위: App/main, 공통 인증 요청/계정 context, Python API 접근 경계, 계정 데이터 계약, Python 의존성과 테스트 실행 설정.
- 실제 적용: 사용자가 최초 관리자 생성 후 기존 AIS/GFW 키가 있는 창에서 8093 서버 재시작 완료를 알렸다. HTTP 확인에서 bootstrap-status의 setupRequired=false, 미로그인 catalog 요청은 401이다. 실제 사용자 비밀번호는 읽거나 저장하지 않았다.
- 후속 범위: 공용 API 키 암호화 저장 UI, HP 서버 배포. 이번 구현의 완료 범위에 포함하지 않는다.
