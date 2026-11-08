# Voyage Registry Implementation Plan

> For agentic workers: execute sequentially with superpowers:executing-plans. Preserve the current integration worktree; no commit/push/deploy without user instruction.

**Goal:** 공용 선박·항차·화물 원장을 직접 입력하고 XLSX로 검토 후 일괄 반영한다.
**Architecture:** 기존 Python/SQLite와 인증을 재사용한다. 서버의 필드 메타데이터가 한글 Excel 헤더와 프런트 폼을 함께 정의한다. revision 검사와 감사 이력을 저장 트랜잭션에 묶는다.
**Tech Stack:** FastAPI, sqlite3, openpyxl, React, existing design tokens.
**Spec:** docs/voyage-registry-design.md

## Constraints and decisions
- 사용자 확정에 따라 승인된 모든 팀원이 공용 원장을 편집한다. 실제 ZGX 쓰기·배포는 수행하지 않는다.
- 화물별 destination_plant_id와 planned_t / bl_t를 사용한다. 항차는 주 도착항 정보를 유지한다.
- 전체 헤더 필수, 빈 셀은 선택 값 비우기, 누락 행은 보존. 코드 수정은 UI에서 금지한다.
- 내보낸 파일 revision과 서버 revision이 다르면 변경 전후를 표시하고 재확인한다. 최종 적용에는 현재 preview revision을 요구한다.
- 기존 private workspace와 supply engine을 변경하지 않는다.

## Steps
- [x] backend/tests/test_voyage_registry.py: 격리 DB 영속성, FK, 유효성, 다중 화물, 원자성, 충돌, XLSX 왕복·오류, 권한 테스트.
- [x] backend/src/midterm/voyage_registry.py: 필드 계약·검증·스키마·저장·미리보기·감사.
- [x] backend/src/midterm/voyage_registry_excel.py: 템플릿/내보내기/업로드 파싱. 수식과 과대 ZIP 거절, 텍스트 식별자 보존.
- [x] backend/src/midterm/web/voyage_registry_api.py + app/auth 경계: 읽기·쓰기·엑셀 preview/commit 연결.
- [x] src/features/vessels/VoyageRegistry.tsx + 전용 CSS: 탭/표/검색/직접 등록/수정/엑셀 검토/내보내기/이력. VesselWorkspace에 진입 버튼.
- [x] 실제 격리 API를 사용하는 UI 테스트. 전체 단위·빌드·UI 검사, 1920/모바일/테마 캡처 확인.
- [x] 데이터 사전·설계·적용 제한·검증 기록 정리. 공용 서버 배포는 별도.

## Review focus
- 엑셀 0/빈값 및 식별자 앞자리 0 보존.
- 동일 배의 여러 항차와 같은 항차의 여러 화물/목적 발전소.
- 잘못된 한 행이 다른 정상 행을 부분 저장하지 않음.
- 다른 사용자의 편집 이후 revision 충돌, 변경 이력 보존.
- 서버 미연결은 오류로 표시하며 로컬 가짜 DB로 대체하지 않음.

## Execution record
- 기존 작업 브랜치 codex/gen4cast-ui-integration, HEAD 67ab2a3를 이어 사용. 기존 사용자 변경 보존, 커밋·push·배포 미실행.
- 저장 테스트는 모듈 미구현으로 실패 확인 후 구현하여 통과. preview는 업무 레코드를 변경하지 않고 commit은 검증·revision·audit를 한 트랜잭션으로 처리.
- 사용자 후속 답변으로 승인된 모든 팀원의 편집 확정. API allowlist는 registry 4개 POST에만 한정하고 기존 설정·입하 정책 유지. API와 실제 로그인 UI로 확인.
- 최종 독립 리뷰 지적 2건 모두 수정: 식별자 상호 교환 UNIQUE 실패를 회귀 테스트로 재현 후 트랜잭션 안에서 식별자를 해제하여 해결. 검증 중 입력 변경을 브라우저 테스트로 재현 후 폼을 잠가 해결.
- 전체 UI 중 새 항차 DB 메뉴의 320px 넘침 발견. 메뉴 최대 너비를 부모에 맞춤. 기존 실패 테스트와 registry 4개 테스트를 묶어 5/5 통과.
- Python DB/엑셀/API/인증 26개 통과, npm test 188개 통과, npm run build 성공. Windows 샌드박스의 로컬 소켓 차단으로 첫 실행 중단 후 격리 서버를 권한 확장 실행하여 검증. 테스트 약화 없음.
- 선박/항차/화물 헤더와 양식 다운로드·가져오기·내보내기, 변경 이력, 작성 안내 및 데이터 사전 작성. 초기 DB는 업무 자료를 가정하지 않는 빈 원장. ZGX 적용은 별도 배포 절차 필요.
- 1920×1080 라이트·다크, 1131px·390px, 엑셀 변경 검토 캡처: artifacts/voyage-registry/. 화면 검토 후 모바일 표에 최소 폭을 주고 내부 가로 스크롤로 긴 식별자를 보존.
- 최종 npm run test:ui: 104/104 통과 (6.3분). npm run build 성공, git diff --check 통과. staged diff는 없음. 공용 배포와 커밋·push·PR은 수행하지 않음.
