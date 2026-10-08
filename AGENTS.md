# GenForecast: AI 작업 규칙

이 저장소를 수정하기 전 CONTRIBUTING.md, SPEC.md, docs/DATA_DICTIONARY.md와 작업 폴더의 하위 AGENTS.md를 읽는다. Git 사용법은 docs/GIT_WORKFLOW.md, 복사할 지시는 docs/AI_PROMPTS.md를 참고한다. 도구가 이 파일을 자동으로 읽는다고 가정하지 않는다.

## 시작과 작업 범위

- 먼저 `git status --short --branch`, `git remote -v`를 확인한다. 원격은 https://github.com/runtosurvive0/genForecast.git 이다. 같은 저장소의 SSH 주소도 가능하다.
- main에서 수정하거나 직접 push하지 않는다. 깨끗한 상태에서 최신 main을 반영하고 작업별 브랜치를 만든다. 이미 해당 작업 브랜치면 이어서 사용한다.
- 사용자 변경·다른 작업의 파일을 보존한다. 변경이 있으면 누구의 작업인지 확인하고 임의 stash/reset/checkout으로 숨기거나 폐기하지 않는다. 브랜치 전환을 서두르지 않는다.
- 한 checkout에서 여러 AI가 동시에 브랜치를 전환하지 않는다. 병렬 작업은 별도 clone 또는 worktree를 사용한다.
- 승인된 작업은 매 단계 재확인하지 않고 진행한다. 목적 밖의 큰 변경이나 합의되지 않은 공통 데이터 계약 변경은 영향과 제안을 먼저 설명한다.

## 폴더와 계약

- 발전소: src/features/plant/; 저탄장: src/features/stockyard/; 선박·지도: src/features/vessels/.
- 화면끼리 직접 import하지 않는다. 공통 표현은 src/components/, 계산·타입은 src/domain/, 샘플은 src/data/를 사용한다. App.tsx가 화면을 연결한다.
- App.tsx, 전역 CSS, 공통 UI, domain/data, 의존성, CI 변경은 PR에 표시하고 통합 담당자 리뷰를 받는다. 폴더 소유는 협업 약속이며 접근 권한 제한은 아니다.
- 상단바·사이드바 구조, 라이트/다크·반응형을 유지한다. 기능 CSS는 해당 폴더에 두고 전용 클래스명을 사용한다. 전역 요소 선택자로 다른 화면을 바꾸지 않는다.
- plant_id, stockpile_id, destination_plant_id, t, kcal/kg, KST 기준과 하역 완료 시 재고 반영을 임의 변경하지 않는다. 재고·입하량 엔진을 화면마다 복제하지 않는다.
- 실시간 AIS는 아직 미연결이다. 더미 좌표·모의 위험도·합성 모델 결과를 실제 운영 정보라고 표시하지 않는다.
- 발전운영_대시보드.html과 dist/는 빌드 결과다. 직접 편집·커밋하지 않는다. 실제 키·사내 자료를 넣지 않는다. VITE_ 변수는 비밀키 보관 장소가 아니다.
- 새 의존성은 필요성을 설명하고 package.json과 package-lock.json을 함께 변경한다. 재현 설치에는 npm ci를 쓴다.

## 검증과 전달

- 코드 변경: npm test, npm run build. UI·스타일·화면 이동·지도 변경: 추가로 npm run test:ui 및 해당 화면 확인. Windows 실행 정책에 막히면 npm.cmd를 사용한다.
- 동작 추가·버그 수정에는 의미 있는 회귀 테스트를 추가한다. 단순 파일 이동은 기존 동작 테스트로 확인한다. 문서만 수정하면 경로·명령·규칙을 검토하고 런타임 검증 생략 이유를 적는다.
- 테스트를 약화하거나 실패를 숨기지 않는다. 못 한 검증은 원인과 함께 명시한다.
- git diff --check, 변경 diff와 staged diff를 확인한다. 이번 작업 파일만 지정하여 stage한다. 관계없는 변경을 포함하거나 git add .로 전체를 담지 않는다.
- 커밋·push·PR은 사용자가 요청한 범위에서 진행한다. 이미 승인된 작업 브랜치 push/PR을 반복 확인할 필요는 없다.
- AI는 자신이 만든 변경을 사람 대신 승인하지 않는다. PR은 다른 팀원 1명의 사람 리뷰와 CI 성공 후 Squash merge한다. AI의 실제 merge는 사용자의 명시적 지시가 있고 위 조건을 확인했을 때만 수행한다.
- force push, reset --hard, clean -fd, 공용 브랜치 삭제와 보호 규칙 우회는 기본 절차에 포함하지 않는다. 자동 승인·자동 merge를 임의 설정하지 않는다.
- 최종 보고: 변경 목적·파일, 브랜치/커밋/PR, 실제 실행한 검증과 결과, 미해결 사항. 문서의 약속과 GitHub에서 강제한 설정을 구분한다.
