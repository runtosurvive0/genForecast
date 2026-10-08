# GenForecast

연료 기반 발전량 전망 시스템. 저장소 이름은 `genForecast`, npm 패키지 이름은 소문자 `genforecast`를 사용합니다.

팀 개발은 [3인 협업 안내](CONTRIBUTING.md) → [Git 실습 가이드](docs/GIT_WORKFLOW.md) 순서로 확인하세요. AI에게는 [작업 지시 예시](docs/AI_PROMPTS.md)와 [AGENTS.md](AGENTS.md)를 전달하세요. 생성된 대시보드 HTML은 Git에서 제외하며 `npm run build`로 만듭니다.

상단 바와 좌측 사이드바 구조를 유지하면서 발전운영 중심으로 개편한 오프라인 데모입니다.

## 바로 열기

처음 clone했다면 `npm ci` 후 `npm run build`로 생성한 `발전운영_대시보드.html`을 브라우저에서 엽니다. 스크립트, 스타일, 세계지도 데이터가 포함되어 네트워크 연결 없이 동작합니다. 원본 `연료수급_종합시스템_오프라인_대시보드.html`은 그대로 보존했습니다.

## 개발

Node.js 24 이상을 권장합니다.

```sh
npm ci
npm run dev
npm test
npm run build
npm run test:ui
```

Windows PowerShell에서 실행 정책으로 npm이 막히면 `npm.cmd`를 사용합니다. 빌드하면 `dist/index.html`과 루트의 `발전운영_대시보드.html`이 갱신됩니다. 브라우저 테스트는 설치된 Chrome을 사용하며 다른 환경에서는 `CHROME_PATH`를 지정하거나 Playwright Chromium을 설치합니다.

## SPEC v0.1 반영 (2026-10-07)

- 발전소 종합 → 저탄장 현황 → 선박 추적 → 예측/모델 상세 → 데이터/관리자. 정지계획·시나리오는 화면 내 동작으로 유지합니다.
- 9개 KPI, Apache ECharts 일별/월별 수급, 호기별 이용률·발전량·연료수요, 16개 Pile과 탄질·위험도.
- Pile 합계가 현재 재고의 원천입니다. 취소/기간 조건을 적용한 입하 예정량과 하역 완료 시점의 재고 반영을 일치시킵니다.
- 150일 합성데이터를 실제 선형회귀로 학습하고 별도 30일로 검증합니다. 평균/최대 수요·석탄가용용량 모델의 재학습 결과가 연료·재고 전망에 반영됩니다.
- AIS 최신성, 좌표·SOG·COG·탄질, ETA/접안/하역 및 체선료. 200척 위치 입력·선택을 브라우저에서 검증합니다.
- 현재 출력은 기준시각의 표본으로 유지하며 재학습·시나리오는 미래 발전량에 적용됩니다.
- Linear 스타일, Aceternity 도트 지도, 라이트/다크, 모바일 drawer, 키보드 조작 및 CSV를 유지합니다.
- API 계약과 AIS decoder/proxy 경계는 준비되어 있지만 FastAPI, DB, 실시간 AIS 및 센서는 미연결입니다. 항로거리/SOG 기반 ETA 재예측, 혼탄 변화, Python/XGBoost/MILP는 후속 범위입니다.

계약·단위·계산 전제는 [데이터 사전](docs/DATA_DICTIONARY.md)을 참고하세요. 원본 SPEC 문서는 수정하지 않았습니다.

## UI Kit 전략

기본 UI는 실제 **shadcn/ui** 레지스트리의 React 컴포넌트입니다. Spectrum 2도 검토했으나 기존 레이아웃을 유지하며 스타일과 업무 구성을 직접 조정하는 요구에 shadcn의 소스 소유 방식이 적합하다고 판단했습니다.

세계지도는 **Aceternity UI World Map**의 공식 소스를 기반으로 업무 화면에 맞게 수정했습니다. `dotted-map`으로 생성한 대륙의 점 데이터와 Motion의 항로 그리기를 사용하며, React Simple Maps는 공통 좌표계와 확대·이동을 담당합니다. 선박 마커와 항로 경유점도 동일한 투영을 사용합니다. 지도 데이터는 번들에 포함되어 외부 타일 서버와 API 키 없이 동작합니다. 상세 항해용 지도가 아닌 전체 운송 개요입니다.

2026-10-07 디자인 개편은 **Linear의 2026년 디자인 개선 사례**를 참고했습니다. 따뜻한 중성색, 낮은 채도의 강조색, 조용한 탐색 메뉴, 줄인 아이콘과 구분선을 적용했습니다. KPI는 하나의 요약 영역, 선박 현황은 지도·선택 패널·간결한 목록으로 정리했습니다. 상단 60px, 사이드바 184px의 기존 배치를 유지합니다. 스타일은 `src/refinement.css`, 도트 지도는 `src/components/ui/world-map.tsx`에서 관리합니다.

지도 점 데이터를 다시 만들 때는 `node scripts/generate-world-dots.mjs`를 실행한 뒤 빌드합니다. 계산량이 많은 지형 생성은 개발 시 한 번 수행하며, 사용자 브라우저에서는 생성된 데이터를 바로 표시합니다. 항로는 선택 시 한 번만 그려지고 동작 줄이기 설정에서는 즉시 표시됩니다.

처리 상태는 **thinking-orbs** 원본 패키지의 `ThinkingOrb`입니다. 계산 중에만 표시하고 한국어 상태 문구, 명시적 테마, upstream의 동작 줄이기/비가시 상태 정지 기능을 사용합니다. 350ms의 최소 표시 시간은 상태가 깜빡이는 것을 방지합니다. SPEC 화면의 전망과 로컬 학습은 브라우저에서 계산합니다.

- shadcn: https://ui.shadcn.com/docs/installation/vite
- Spectrum 2: https://react-spectrum.adobe.com/getting-started
- Thinking Orbs 원 저장소: https://github.com/Jakubantalik/thinking-orbs
- 설치된 패키지의 현재 소스: https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/thinking-orbs
- React Simple Maps: https://github.com/zcreativelabs/react-simple-maps
- Linear 개선 사례: https://linear.app/now/behind-the-latest-design-refresh
- Aceternity World Map: https://ui.aceternity.com/components/world-map
- 공식 소스: https://ui.aceternity.com/registry/world-map.json
- dotted-map: https://github.com/NTag/dotted-map

## 데이터와 계산

**실제 발전사 데이터와 연동하지 않은 샘플입니다.** 기준시각은 2026-10-06 09:00 KST로 고정하며 실제 정비계획·운전 상황을 의미하지 않습니다. API 키나 외부 데이터 연결은 필요하지 않습니다.

`src/domain/operations.ts`에 샘플 및 공통 계산을 모았습니다. 보유 연료의 전력 환산은 다음과 같습니다.

`발전가능량(GWh) = 재고(t) × 발열량(kcal/kg) × 0.001163 × 효율(0~1) ÷ 1,000`

시간별 부하와 정비 시작/종료, 하역 완료 이벤트를 반영합니다. 연료 부족 시 가용 연료만큼 발전하고 음수 재고를 만들지 않습니다. 계획정지는 입력 자료, 연료부족 시점은 계산 결과로 구분합니다. 발전소 간 재고를 자동 공유하지 않습니다.

일별 집계는 당일 09:00부터 다음 날 09:00까지입니다. 그래프의 재고 시각은 집계 종료 시각이며 발전량/하역량은 그 전 24시간 합계입니다. 부하·입항 시나리오는 가정일 뿐 자동 운전 지시가 아닙니다.

실제 운영으로 전환할 때는 샘플 대신 승인된 발전계획, 정비 일정, 재고/탄질, 계약 선박 자료를 공통 모델에 연결해야 합니다. AIS·날씨 API는 현재 연결되지 않았습니다.

## 검증

`tests/operations.test.ts`는 에너지 환산, 영재고/영부하, 정비와 하역 경계, 입항 지연, 재가동, 설비용량 제한을 확인합니다. `tests/ui.spec.ts`는 테마 저장, 필터, 시나리오 명시적 적용, Orbs, 슬라이더 접근성, 모바일, 세계지도 선택, 오프라인 단일 HTML을 확인합니다.

`scripts/capture.mjs`로 라이트/다크·모바일 검토용 이미지를 `artifacts/`에 생성할 수 있습니다.
