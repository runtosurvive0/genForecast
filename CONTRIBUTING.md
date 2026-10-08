# GenForecast 팀 협업 안내

**각자 자기 컴퓨터의 작업 폴더에서, 작업마다 브랜치를 만들고, PR을 통해 main에 합친다.** AI가 작성한 코드도 올린 사람이 이해하고 검증한다. 관리자도 같은 규칙을 따른다.

처음 참여하면 [Git 실습 가이드](docs/GIT_WORKFLOW.md)를 순서대로 읽는다. AI에게 맡길 때는 [AI 작업 지시 예시](docs/AI_PROMPTS.md)를 복사하고 [AGENTS.md](AGENTS.md)를 읽도록 한다.

## 화면별 작업 위치

세 화면을 별도 모듈로 분리했다. 이 분리 PR이 main에 합쳐진 뒤 팀원들은 최신 main에서 기능 작업을 시작한다.

```text
src/
  features/
    plant/       # 발전소 종합: PlantOverview.tsx, plant.css
    stockyard/   # 저탄장: Stockyard.tsx, stockyard.css
    vessels/     # 선박: VesselTracking.tsx, VesselMap.tsx, 전용 CSS
    models/      # 모델 상세·재학습 화면 (통합 담당)
    data/        # 데이터/관리자 화면 (통합 담당)
  components/
    tower/       # Section·Metric·ModelCard·차트 옵션·공통 스타일
    ui/          # shadcn·도트 지도 기반 UI
  domain/        # 재고·발전량·AIS 규약·모델의 공통 계산/타입
  data/          # 공통 샘플 데이터
  App.tsx        # 메뉴·테마·범위·시나리오·화면 연결
```

| 역할 | 주 작업 폴더 | 함께 검토할 부분 |
|---|---|---|
| 발전소 종합 담당 | src/features/plant/ | KPI·전망과 공통 재고 계산의 일치 |
| 저탄장 담당 | src/features/stockyard/ | Pile 합계·탄질 단위·발전소 ID |
| 선박 담당 | src/features/vessels/ | AIS·화물·ETA·하역 완료 시각과 입하량 |
| 통합 담당 (기본: 발전소 종합 담당) | App·공통 UI·domain/data·models/data 화면·CI | 공통 계약, 패키지, 여러 화면 영향 |

SPEC §4의 기능 소유권을 따라 발전소 종합 담당이 통합을 겸임하는 것을 기본으로 한다. SPEC에 적힌 기본 브랜치 이름은 첫 작업에 사용할 수 있지만 영구 브랜치로 유지하지 않는다. 브랜치 수명·PR·머지 절차는 이 안내의 작업별 규칙을 적용하며, 제품 기능·데이터 계약은 계속 SPEC을 따른다.

역할별 실제 계정은 팀에서 정한다. 관리자 puyo-git, fecaesar의 화면 담당을 임의로 지정하지 않았다. 세 번째 팀원 가입 후 담당을 확정하면 CODEOWNERS에 등록할 수 있다. 지금은 CODEOWNERS 파일이 없으므로 리뷰어를 직접 선택한다.

화면끼리 직접 import하지 않는다. 함께 쓰는 코드는 공통 폴더로 옮기고 통합 담당자에게 리뷰를 받는다. 폴더 분리가 동시 수정 충돌을 줄이지만, 공통 파일 충돌까지 없애지는 않는다.

## 팀의 브랜치·머지 규칙

| 항목 | 규칙 |
|---|---|
| 기준 브랜치 | main: 항상 실행 가능한 팀 공통 버전 |
| 작업 브랜치 | 한 작업당 하나. feature/plant-..., feature/stockyard-..., feature/vessels-..., fix/..., docs/..., refactor/... |
| 작업 크기 | 한 PR은 하나의 목적. 사람별 영구 브랜치와 별도 develop 브랜치는 만들지 않음 |
| main 반영 | 직접 push 금지, PR만 사용 |
| 리뷰 | 작성자 외 팀원 1명 이상. AI 리뷰는 보조이며 사람 승인을 대체하지 않음 |
| 공통 변경 | 통합 담당자 검토 필요. 작성자가 통합 담당자이면 다른 팀원이 검토 |
| 검증 | 코드: 단위 테스트·빌드. UI 관련: 브라우저 테스트·해당 화면 확인 |
| 머지 | 최신 변경 리뷰·CI 성공·충돌 및 리뷰 대화 해결 후 **Squash and merge** |
| 머지 담당 | 위 조건을 확인한 작성자 또는 통합 담당자. AI에게는 별도의 명시적 머지 지시 필요 |
| 다음 작업 | 최신 main에서 새 브랜치. 이미 머지한 브랜치를 재사용하지 않음 |

## 공통 약속

- 데이터 필드·단위·시각은 [SPEC](SPEC.md)과 [데이터 사전](docs/DATA_DICTIONARY.md)을 따른다. 재고는 Pile 합계, 입하는 하역 완료 시점으로 계산한다.
- 상단바·사이드바·테마와 공통 Button/차트를 공유한다. 기능 CSS는 해당 기능 폴더에 둔다.
- Node.js 24, 최초 설치는 npm ci를 사용한다. PowerShell에서는 npm.cmd로 실행해도 된다.
- 원본 코드는 src/다. 발전운영_대시보드.html은 npm run build 결과이므로 직접 수정/커밋하지 않는다.
- API 키와 실제 사내 자료는 공개 저장소에 올리지 않는다. AISstream 키는 향후 서버 환경변수에 둔다. 현재 AIS는 미연결이다.
- 변경 파일을 지정하여 stage하고 push 전에 diff를 직접 확인한다. AI가 만든 관계없는 변경·불필요한 의존성·검증되지 않은 계산을 포함하지 않는다.

## GitHub 관리자 설정

아래는 **설정할 값**이다. 문서를 추가했다고 GitHub 보호가 활성화되는 것은 아니다. 이번 작업에서는 원격 보호 설정을 변경하지 않았다.

Settings → Branches의 main 보호 규칙(또는 같은 효과의 Ruleset)에 다음을 적용한다.

- PR 필수, 승인 1명, 새 변경 push 시 이전 승인 해제, 미해결 리뷰 대화 해결 필수.
- 필수 상태 검사는 실제 Actions에서 나타나는 verify. main이 최신인지 확인하는 옵션도 사용한다.
- 관리자도 우회하지 못하도록 설정. Force push와 삭제 허용은 끈다.
- Settings → General → Pull Requests에서 Squash merging을 사용하고, 팀 혼동을 줄이려면 다른 머지 방식은 끈다. 머지 후 작업 브랜치 자동 삭제를 켤 수 있다.

현재 CI의 verify는 npm ci, npm test, npm run build를 실행한다. **브라우저 테스트는 CI에 없으므로 UI 변경 PR에 로컬 실행 결과를 남겨야 한다.** 공개 저장소의 브랜치 보호는 GitHub Free 조직에서도 제공된다. 관리자 우회 차단은 별도 옵션이다. [GitHub 보호 브랜치 공식 설명](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

CODEOWNERS는 담당자 리뷰 요청을 돕지만 수정 권한을 제한하지 않는다. 담당 확정 후 실제 계정으로 추가하며, 소유자 승인 강제는 별도 설정한다. [공식 CODEOWNERS 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
