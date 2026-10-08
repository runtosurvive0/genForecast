# 3인 협업 안내

한 저장소와 하나의 React 앱을 공유한다. 화면별 폴더를 나누고 기능 단위의 짧은 브랜치에서 작업한 뒤 PR로 `main`에 통합하는 방식을 권장한다. `main`은 항상 실행 가능한 상태로 유지한다.

## 현재 상태와 먼저 할 작업

현재 세 화면은 `src/components/ControlTower.tsx` 안에 함께 있다. 아래 폴더 구조는 **권장 목표이며 아직 적용되지 않았다**. 세 명이 동시에 기능을 추가하기 전에 통합 담당자가 파일 분리만 하는 PR을 먼저 올리고, 테스트 통과 후 합친다. 팀원은 그 이후 main에서 작업을 시작한다.

```text
src/
  features/
    plant/       # 발전소 종합 화면, 화면 전용 컴포넌트와 스타일
    stockyard/   # Pile·탄질·위험도 화면, 전용 계산과 테스트
    vessels/     # 선박·지도·AIS·ETA 화면, 전용 계산과 테스트
  components/    # 공통 UI·차트·Thinking Orbs
  domain/        # 공통 계약, 재고 및 발전 계산
  data/          # 합의한 더미 데이터
  App.tsx        # 메뉴·테마·발전소 선택·기간·페이지 연결
```

| 담당 | 소유 기능 | 공통 협의 대상 |
|---|---|---|
| 통합 담당 / 발전소 종합 | KPI, 수급 전망, 모델 출력 연결, App 레이아웃, PR 통합 | 공통 데이터 계약, 재고 엔진, 의존성 |
| 저탄장 담당 | Pile 배치·상세, 탄질, 모의 위험도 | Pile 합계, 열량 단위, `plant_id` |
| 선박 담당 | 지도, AIS Provider, 화물·ETA·체선료 | 입하량·하역 완료 시각, `destination_plant_id` |

사람별 영구 브랜치를 유지하지 않는다. 영역 prefix는 유지하되 한 작업마다 브랜치를 만든다. 예: `feature/plant-inventory-chart`, `feature/stockyard-pile-detail`, `feature/vessels-aisstream`. SPEC의 `feature/plant-integration`, `feature/stockyard`, `feature/vessel-tracking`은 초기 작업에 사용할 수 있다. merge 후 다음 작업은 최신 main에서 새 브랜치를 만든다.

## 처음 실행

팀 저장소를 각자의 컴퓨터에 clone한다. Node.js 24를 사용한다.

```sh
npm ci
npm run dev
```

Windows PowerShell 실행 정책 때문에 npm이 막히면 `npm.cmd`를 사용한다. 파일 탐색기의 HTML 대신 개발 서버에서 작업한다. `발전운영_대시보드.html`은 `npm run build`로 재생성하는 배포 결과물이므로 직접 수정하거나 커밋하지 않는다. `index.html`, `src/`, `package-lock.json` 및 원본 참고 HTML은 추적한다.

## 매 작업 순서

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/stockyard-pile-detail

# 코드 수정 후
npm test
npm run build
# 화면 동작을 바꿨다면: npm run test:ui

git add src/features/stockyard tests
git commit -m "feat(stockyard): add pile detail panel"
git push -u origin feature/stockyard-pile-detail
```

`src/features/...`는 폴더 분리 후 경로다. 그 전에는 실제 수정한 파일만 지정한다. 브랜치 생성 전 작업 폴더가 깨끗한지 확인하며, 진행 중인 변경을 잃는 reset/강제 덮어쓰기를 사용하지 않는다.

GitHub에서 main을 대상으로 PR을 만들고 다른 팀원 한 명의 리뷰를 받는다. 공통 계약·App·패키지 변경은 통합 담당자가 확인한다. 테스트가 통과하면 squash merge하고 원격 작업 브랜치를 정리한다. 다음 작업은 다시 main에서 시작한다. 충돌이 나면 로컬의 미완료 변경을 먼저 보존한 후 `git fetch origin`, `git merge origin/main`으로 합의한 최신 코드를 반영하고 재검증한다.

작업 단위는 'Pile 선택 및 상세 패널'처럼 검토할 수 있게 작게 잡는다. 한 PR에 UI 전면개편·API 계약 변경·의존성 갱신을 함께 넣지 않는다. GitHub Issues에 영역별 작업을 등록해 담당자를 한 명 지정하고 PR에서 해당 이슈를 연결한다.

## 서로 지킬 공통 약속

- `SPEC.md`와 `docs/DATA_DICTIONARY.md`가 필드·단위·시간의 기준이다. `plant_id`, `stockpile_id`, 화물량 t, 열량 kcal/kg, KST 시각을 임의 변경하지 않는다.
- 발전소 종합은 저탄장과 선박 데이터를 같은 공통 계산 엔진으로 집계한다. 화면마다 재고·입하량 계산을 복사하지 않는다.
- 상단바, 사이드바, 테마, 공통 Button/Card 및 전역 CSS는 통합 담당자와 조율한다. 화면 담당자는 해당 화면 아래로 스타일을 한정한다.
- 새 패키지는 사전 공유하고 package.json과 package-lock.json을 함께 변경한다. 설치는 기본적으로 `npm ci`, 의존성 추가는 `npm install <package>`를 사용한다.
- 실제 사내 데이터와 API 키를 커밋하지 않는다. AISstream 키는 추후 서버 환경변수에 둔다. `VITE_` 변수는 브라우저에 포함되므로 비밀키 용도로 사용하지 않는다.
- `.env`, node_modules, 캐시, 스크린샷·테스트 결과, 빌드 HTML은 제외한다. 배포 HTML 공유는 GitHub Release 첨부 또는 별도 전달을 이용한다.
- Codex를 사용할 때도 각자 자신의 브랜치에서 작업한다. 예: “저탄장 Pile 상세를 수정해 줘. 변경은 stockyard 폴더에 한정하고, 공통 계약이 필요하면 먼저 변경점을 알려줘.”

## 저장소 관리자 설정 (원격 저장소에서 설정 필요)

기본 브랜치를 main으로 두고 PR 리뷰 1명, CI의 `verify` 성공, 미해결 리뷰 대화 해결을 요구하는 규칙을 권장한다. main 직접 push/force push를 막는다. 저장소 공개 범위와 GitHub 요금제에 따라 보호 기능 사용 가능 여부를 확인한다.

실제 GitHub 계정을 확정한 뒤 `.github/CODEOWNERS`에 화면 폴더 담당자를 등록한다. 현재는 계정을 알 수 없어 소유자 파일을 생성하지 않았다. CODEOWNERS는 리뷰 요청을 돕는 기능이며, 단독으로 수정 권한을 제한하지 않는다. 소유자 승인 강제는 별도 보호 규칙에서 설정한다.

`.github/workflows/ci.yml`은 PR/push에서 계산 테스트와 타입 검사·빌드를 실행한다. GitHub에서의 실행은 업로드 후 확인해야 한다. UI 테스트는 로컬 Chrome 또는 `npx playwright install chromium`으로 설치한 브라우저에서 실행한다.

참고: [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow), [보호 브랜치](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
