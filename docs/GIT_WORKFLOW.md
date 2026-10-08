# 처음부터 따라 하는 팀 Git 가이드

저장소: https://github.com/runtosurvive0/genForecast

**clone은 처음 한 번, branch는 작업마다, merge는 리뷰 후에 한다.** 내 폴더가 이미 이 저장소와 연결되어 있다면 다시 clone하지 않는다. 이 화면 분리 PR이 main에 합쳐진 뒤 아래 기능 폴더 기준으로 개발한다.

## 1. 용어와 전체 흐름

| 용어 | 우리 작업에 대입하면 |
|---|---|
| 원격 저장소 origin | GitHub에 있는 팀 공통 저장소 |
| clone | 원격 저장소와 이력을 내 컴퓨터에 처음 내려받기 |
| main | 팀이 검토하고 합친 기준 버전 |
| branch | 한 기능을 개발하는 별도 이력. 폴더 복사본은 아님 |
| stage / commit | 저장할 파일 선택 / 내 컴퓨터의 Git 이력에 기록 |
| push | 내 커밋을 같은 이름의 GitHub 작업 브랜치로 올리기 |
| fetch | 원격 이력만 가져오기. 현재 코드에 합치지는 않음 |
| pull --ff-only | 원격 이력을 가져오고 내 이력이 갈라지지 않았을 때만 앞으로 이동 |
| PR (Pull Request) | 내 브랜치 변경을 main에 합쳐 달라는 검토 요청 |
| review / merge | 다른 사람이 변경 확인 / 두 이력의 변경을 통합 |

```text
최신 main → feature/stockyard-pile-detail → 수정·검증·commit·push
                                                ↓
                                      PR → 동료 리뷰 → Squash merge
                                                                  ↓
                                                   새 main → 다음 작업 브랜치
```

push는 main 반영이 아니다. PR 생성도 merge가 아니다. 브랜치를 바꾸면 **같은 폴더의 파일 내용이 바뀐다**. 하나의 폴더를 여러 AI 세션이 동시에 조작하지 않는다. 병렬 작업이 필요하면 별도 clone/worktree를 사용한다.

## 2. 처음 참여할 때 한 번

팀 관리자의 초대를 수락한다. 공개 저장소는 누구나 clone할 수 있지만 push·리뷰 승인에는 적절한 저장소 권한이 필요하다. 일반 개발자는 Write로 작업할 수 있다.

저장소 밖의 개발용 부모 폴더에서 실행한다. 기존 프로젝트 안에 중첩 clone하지 않는다.

```sh
git clone https://github.com/runtosurvive0/genForecast.git
cd genForecast
git remote -v
git status --short --branch
npm ci
npm run dev
```

Node.js 24를 사용한다. PowerShell에서 npm 실행 정책 오류가 나면 모든 npm 명령을 npm.cmd로 실행한다. dev 서버 종료는 Ctrl+C다. 브라우저에서 터미널에 표시된 개발 서버 주소를 연다.

커밋 작성자 정보가 없다면 아래 따옴표 내용을 본인 값으로 바꿔 이 저장소에 설정한다. GitHub 이메일 공개가 싫으면 GitHub Settings → Emails의 본인 noreply 주소를 쓸 수 있다.

```sh
git config user.name "본인 이름"
git config user.email "본인 GitHub 이메일"
```

이미 쓰는 폴더에서는 git remote -v가 위 저장소를 가리키고 git status가 정상인지 먼저 확인한다. 맞으면 계속 사용한다. .git 폴더를 지우거나 중복 초기화하지 않는다.

## 3. 새 작업 시작 — 매번

먼저 git status를 확인한다. 수정 파일이 있으면 현재 작업을 먼저 별도 커밋으로 보존하거나 담당자와 정리한다. 아래 명령으로 무조건 넘어가지 않는다.

```sh
git status --short --branch
git switch main
git pull --ff-only origin main
git switch -c feature/stockyard-pile-detail
```

예시는 저탄장 Pile 상세 작업이다. 발전소는 feature/plant-inventory-chart, 선박은 feature/vessels-ais-freshness처럼 목적을 넣는다. 이미 쓰인 이름이나 머지한 브랜치는 재사용하지 않는다. pull --ff-only가 실패하면 main 이력이 갈라진 이유부터 확인한다. reset이나 force push로 맞추지 않는다.

GitHub Issue에 목표·완료 조건·담당자를 적거나 팀에서 같은 내용을 합의한 후 시작한다. 공통 App/domain/data/패키지까지 바꿔야 한다면 영향부터 공유한다. 사람별 영구 브랜치, 각 화면의 별도 main, 별도 develop 브랜치는 필요 없다.

## 4. 개발·검증·commit·push

AI에게 [작업 지시 예시](AI_PROMPTS.md)를 전달한다. source는 src/이고 빌드 HTML은 결과물이다. 개발을 마치면 아래를 실행한다.

```sh
npm test
npm run build
npm run test:ui
git diff --check
git diff --stat
git diff
```

UI 변경에는 브라우저 테스트가 필수다. Chrome이 없는 환경은 npx playwright install chromium을 한 번 실행한다. 라이트/다크와 좁은 화면의 실제 동작도 확인한다. 문서만 고치면 경로·명령을 검토하고 런타임 테스트를 생략한 이유를 PR에 적을 수 있다.

아래는 **두 파일만 수정한 경우**다. 본인이 실제로 수정한 파일과 새 테스트만 지정한다. 파일 경로를 그대로 따라 넣기 전에 git status를 읽는다.

```sh
git add src/features/stockyard/Stockyard.tsx src/features/stockyard/stockyard.css
git diff --cached --stat
git diff --cached
git commit -m "feat(stockyard): add pile detail panel"
git push -u origin feature/stockyard-pile-detail
```

commit은 로컬 기록, push는 팀 서버에 올리는 단계다. .env, 키, 사내 자료, node_modules, dist, 테스트 결과, 생성 HTML을 올리지 않는다. push가 거절되면 로그인·Write 권한·원격 브랜치 변경 여부를 확인한다. --force로 해결하지 않는다.

같은 PR을 보완할 때는 같은 작업 브랜치에서 수정 → 검증 → 해당 파일 add → 새 commit → git push를 반복한다. PR은 자동 갱신된다. 리뷰 후 변경된 코드에는 다시 리뷰를 받는다.

## 5. GitHub에서 PR 만들기와 리뷰

1. 저장소의 Compare & pull request 또는 Pull requests → New pull request를 연다.
2. base는 main, compare는 내 작업 브랜치인지 확인한다.
3. 템플릿에 목적·변경 영역·실제 검증 결과를 쓴다. UI는 전후 화면, 계산은 입력/기대 결과를 포함한다. Issue가 있으면 Closes #번호로 연결한다.
4. 개발 중이면 Draft, 검증을 마쳤으면 리뷰 가능한 PR로 둔다.
5. 작성자 외 팀원 한 명에게 리뷰를 요청한다. 공통 파일은 통합 담당자가 본다. 통합 담당자가 작성자면 다른 팀원이 리뷰한다.

리뷰어는 Files changed에서 요청과 무관한 변경이 없는지, 계산·데이터·단위가 맞는지, 실제 실행 결과가 있는지 본다. 필요하면 본인 변경을 보존한 뒤 별도 브랜치/작업 폴더로 받아 실행한다. 마지막에는 Review changes → Approve 또는 Request changes를 선택한다. 댓글이나 AI의 “문제 없음”은 사람 승인과 같지 않다.

## 6. 다른 사람의 main 변경 가져오기와 충돌

**내 작업 브랜치에서, 작업 폴더가 깨끗한 상태로** 실행한다. 미완료 변경이 있으면 먼저 자신의 변경을 보존한다. 커밋할 수 없는 상태라면 임의로 없애지 말고 도움을 요청한다.

```sh
git status --short --branch
git fetch origin
git merge origin/main
```

이 merge는 최신 main을 내 작업 브랜치에 가져오는 것이다. 내 코드를 main에 배포하는 동작이 아니다. 초반에는 rebase와 force push를 섞지 않고 이 방식으로 통일한다.

충돌이 생기면 git status에 충돌 파일이 나온다. 충돌 표시는 다음과 같다.

| 표시 | 의미 |
|---|---|
| `<<<<<<< HEAD` | 이 아래는 내 작업 브랜치 내용 |
| `=======` | 양쪽 변경의 경계. 이 아래는 가져온 main 내용 |
| `>>>>>>> origin/main` | 가져온 main 내용의 끝 |

두 변경의 목적을 비교하고 필요한 내용을 합친 후 표시 줄을 제거한다. Accept Current/Incoming/All을 파일 전체에 무조건 적용하지 않는다. 공통 계약·계산의 의미를 판단할 수 없으면 해당 변경 작성자와 확인한다. 충돌 표시만 지웠다고 해결된 것은 아니다.

해결한 각 파일을 git add로 지정하고 검증을 실행한 뒤 merge commit을 완료한다. 아래 path/to/resolved-file은 실제 파일로 바꾼다.

```sh
git add path/to/resolved-file
npm test
npm run build
npm run test:ui
git diff --cached
git status
git commit -m "merge: sync main into stockyard feature"
git push
```

진행 중인 merge를 취소하려면, merge 시작 전 깨끗한 상태였음을 확인하고 git merge --abort를 사용한다. merge 도중 새로 한 해결 작업은 보존되지 않으므로 필요하면 먼저 복사해 둔다. 원래 작업을 삭제하는 reset --hard는 사용하지 않는다. package-lock.json 충돌도 전체를 한쪽 것으로 덮지 말고 package.json의 의도와 함께 통합 담당자가 확인한다.

## 7. 머지와 다음 작업

머지 전 작성자 또는 통합 담당자가 다음을 모두 확인한다.

- 최신 diff에 대해 작성자 외 **사람 1명 이상 승인**.
- CI verify 성공. UI 변경은 로컬 브라우저 테스트 결과도 존재.
- 충돌 없음, 리뷰 의견 해결, 최신 main 변경 반영. main을 새로 합쳐 diff가 바뀌면 재검증·재리뷰.
- 공통 계약 변경은 통합 담당자 검토. 작성자가 통합 담당자면 다른 팀원의 검토.

GitHub의 **Squash and merge**로 PR 전체를 main의 하나의 커밋으로 합친다. 완결된 기능 단위라 이력과 되돌리기가 쉬워진다. AI에게는 위 조건을 확인한 후 별도로 머지 지시를 내린다. 승인 없는 자동 머지는 하지 않는다.

머지 완료 표시를 확인한 후 GitHub의 Delete branch로 해당 원격 작업 브랜치를 정리할 수 있다. 내 컴퓨터에서는 다음 작업 전:

```sh
git status --short --branch
git switch main
git pull --ff-only origin main
git fetch --prune
git switch -c feature/stockyard-next-task
```

역시 전환 전 수정 파일이 없어야 한다. Squash merge 이후 로컬 git branch -d가 “완전히 머지되지 않았다”고 거절할 수 있다. PR 내용은 합쳐져도 커밋 ID가 달라서 생기는 경우다. 삭제를 강제하지 않고 남겨 둬도 된다. 정리할 때는 PR이 Merged인지와 빠진 커밋이 없는지를 확인한다.

## 8. 자주 생기는 상황

| 상황 | 할 일 |
|---|---|
| main에서 실수로 편집했지만 아직 commit 안 함 | 변경을 버리지 말고 새 작업 브랜치로 이동해 보존. 충돌/차단 시 멈추고 상태 확인 |
| 이미 main에 로컬 commit함 | 현재 commit을 가리키는 보존 브랜치를 먼저 만들고 통합 담당자와 정리. main에 바로 push하지 않음 |
| 다른 팀원이 같은 파일을 수정 | 최신 main을 내 작업 브랜치에 merge하고 의미를 비교. 먼저 공통 변경 PR을 작게 합치면 충돌 감소 |
| push 거절 | 권한/로그인/원격 추가 커밋 확인. 다른 사람 작업을 force push로 덮지 않음 |
| CI 실패 | Actions 로그에서 실패 명령을 확인하고 같은 명령을 로컬 실행. 테스트를 끄거나 성공했다고 보고하지 않음 |
| 머지 뒤 문제가 발견됨 | 수정 PR 또는 해당 squash commit을 되돌리는 revert PR. 공유 main 이력을 reset하지 않음 |
| AI가 관계없는 파일까지 수정 | diff를 확인하고 그 변경의 출처를 구분. 사용자 작업인지 모르면 일괄 복구하지 않음 |

## 문서와 자동 강제의 차이

AGENTS.md는 AI 작업 지침이고, 이 문서는 팀 약속이다. 실제 직접 push/무승인 머지 차단은 GitHub 보호 규칙이 담당한다. [관리자 설정](../CONTRIBUTING.md#github-관리자-설정)은 별도로 적용해야 한다. 이번 변경에서 원격 보호 설정은 바꾸지 않았다.

이 흐름은 작업별 브랜치·PR·리뷰·머지를 사용하는 [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)를 우리 3인 팀에 맞춰 정리한 것이다.
