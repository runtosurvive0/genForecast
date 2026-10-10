# GenForecast 디자인 시스템

UI를 만들거나 고치는 사람과 AI가 **수정 전에** 읽는 문서다. 화면 담당이 달라도 같은 제품처럼 보이도록 색·글자·간격·구성 규칙을 한곳에 정한다.

- 적용 범위: `src/` 아래 모든 화면과 공통 UI. 지도 스타일(`src/features/vessels/map-style.ts`)도 색 규칙을 따른다.
- 기준 구현: 값의 원천은 코드다. 이 문서와 코드가 다르면 **`src/refinement.css` → `src/index.css` → `src/components/tower/`** 순으로 확인하고, 문서를 고치는 PR을 올린다.
- 우선순위: AGENTS.md(작업 규칙) > 이 문서(시각 규칙) > 화면별 AGENTS.md > 개인 취향·외부 레퍼런스.
- 이 문서의 규칙은 팀 내부 약속이다. 아직 lint나 CI로 검사하지 않는다.

---

## 1. 디자인 원칙

1. **조용한 컨트롤 타워.** 숫자와 위험 신호가 주인공이다. 장식(그라데이션, 진한 배경 헤더, 그림자, 컬러 카드)은 쓰지 않는다.
2. **컨테이너는 적게.** 카드 안에 카드를 넣지 않는다. 구분은 1px `--border` 선과 여백으로 한다.
3. **색은 의미가 있을 때만.** 기본은 무채색(neutral)이다. 강조는 `--primary` 1가지, 상태 표시는 §3.3의 상태색만 쓴다.
4. **토큰만 사용.** 기능 CSS에 hex 값을 직접 쓰지 않는다. 라이트/다크는 토큰이 처리한다.
5. **정직한 표시.** 더미 좌표·모의 위험도·합성 모델 결과에는 그 사실을 화면에 표기한다(AGENTS.md 규칙).

---

## 2. 레이아웃 셸 (변경 금지)

App.tsx와 전역 CSS가 소유한다. 기능 화면은 `main-content` 안쪽만 그린다.

| 요소 | 값 | 정의 위치 |
|---|---|---|
| 상단바 `.top-bar` | 높이 60px, 배경 `--background`, 하단 1px 선 | index.css, refinement.css |
| 사이드바 `.sidebar` | 폭 184px, 배경 `--sidebar`, 선 없음 | index.css, refinement.css |
| 본문 `.main-content` | padding `32px 36px 0`, 최대 폭 1920px | refinement.css |
| 페이지 제목 `.page-heading h1` | 25px / 600 / letter-spacing -0.9px | refinement.css |
| 컨텍스트 바 `.context-bar` | 발전소 선택·기간·시나리오. 하단 1px 선 | index.css, refinement.css |

기능 화면에서 위 클래스를 다시 정의하거나 `body`, `h1`, `button` 같은 요소 선택자로 전역 스타일을 바꾸지 않는다.

---

## 3. 디자인 토큰

`src/main.tsx`는 `index.css` 다음에 `refinement.css`를 로드한다. **실제 화면 값은 refinement.css 값이다.** index.css의 teal 계열 값은 덮어써진 이전 값이므로 참고하지 않는다.

### 3.1 색상 토큰

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--background` | `#fcfcfb` | `#19191c` | 페이지 배경 |
| `--card` | `#fcfcfb` | `#19191c` | 섹션 배경(배경과 같은 값. 구분은 선으로 한다) |
| `--foreground` | `#27272b` | `#e7e7ea` | 본문·숫자 |
| `--muted-foreground` | `#75757c` | `#a1a1aa` | 라벨·보조 설명·축 |
| `--primary` | `#5c61b6` | `#a2a5ed` | 유일한 강조색(선택 상태, 주 계열, 포커스) |
| `--primary-foreground` | `#fff` | `#202137` | primary 위 글자 |
| `--secondary` / `--muted` | `#f0f0ef` / `#f3f3f2` | `#252528` / `#222225` | 세그먼트 배경, 입력 배경 |
| `--accent` | `#ededed` | `#2b2b30` | hover, 활성 메뉴 |
| `--border` | `#e7e7e5` | `#303034` | 모든 구분선 |
| `--teal-soft` / `--teal-ink` | `#f0f0f8` / `#565ba8` | `#292936` / `#afb1eb` | primary 계열의 옅은 배경과 진한 글자. 이름은 과거 값에서 남은 것이다 |
| `--amber` / `--amber-soft` | `#956319` / `#faf4e9` | `#dbb573` / `#332d23` | 주의·가정·추정값 |
| `--destructive` | `#bb5555` | `#e99090` | 위험·오류 |

Tailwind/shadcn 클래스(`bg-primary`, `text-muted-foreground`, `border-border` 등)는 index.css의 `@theme inline`에서 같은 토큰에 연결되어 있다.

### 3.2 차트 팔레트

ECharts는 `src/components/TowerChart.tsx`를 통해 그린다. 계열 색은 순서대로 쓴다.

| 순서 | 색 | 권장 의미 |
|---|---|---|
| 1 | `#7181db` | 주 계열(실적·예측 본선) |
| 2 | `#49a28f` | 보조 계열·정상 범위 |
| 3 | `#c08e52` | 비교·가정 시나리오 |
| 4 | `#85919e` | 기준선·과거값 |

- 축 글자는 라이트 `#646874`, 다크 `#a5a7b1`, 크기 11px이다(TowerChart가 처리한다).
- 그리드 선은 `#88888818`이다. 축 정의는 `src/components/tower/chart-options.ts`의 `axis()`, `line()`을 재사용한다.
- 화면에서 계열 색 배열을 새로 정의하지 않는다. 5개 이상 계열이 필요하면 먼저 이 표에 추가하는 PR을 올린다.
- 예측 구간은 점선(`lineStyle.type: "dashed"`)으로 실적과 구분한다.

### 3.3 상태색 (위험도)

현재는 화면마다 값이 흩어져 있다. 새 코드는 아래 표를 따른다. 통합 담당자 승인 전까지는 각 기능 CSS에서 아래 hex 값을 쓰되, **토큰화 후 교체할 수 있도록 한 곳(파일 상단)에 모아 둔다.**

| 상태 | 한글 표기 | 글자/선 | 옅은 배경 | 현재 사용처 |
|---|---|---|---|---|
| normal | 정상 | `--muted-foreground` 또는 `#49a28f` | 없음 | 정상은 색으로 강조하지 않는 것이 기본 |
| caution | 주의 | `--amber` | `--amber-soft` | stockyard `risk-medium`(`#b3935e`) |
| danger | 위험 | `#b35f54` | 같은 색 8% 내외 | tower `.tower-status.risk`, stockyard `risk-high`(`#be7963`) |
| unknown | 미확정 | `--muted-foreground` | 없음 | |

- 상태는 **색만으로 전달하지 않는다.** 항상 "정상/주의/위험/미확정" 글자나 아이콘을 함께 둔다.
- 상태 배지는 `.tower-status` 모양(1px 테두리, radius 4px, 9~10px 글자)을 쓴다. 채워진 알약(pill) 배경은 쓰지 않는다.

> 제안(미반영): `--status-caution`, `--status-danger` 등을 refinement.css에 토큰으로 추가하면 다크 모드 개별 지정이 필요 없다. 전역 CSS 변경이므로 통합 담당자 리뷰 후 진행한다.

### 3.4 타이포그래피

글꼴: `Inter, "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`. 본문 기본 14px, letter-spacing -0.15px. 숫자에는 `font-variant-numeric: tabular-nums`를 쓴다.

| 역할 | 크기 / 굵기 | 예시 클래스 |
|---|---|---|
| 페이지 제목 | 25px / 600 | `.page-heading h1` |
| KPI 숫자 | 29px / 550, 1100px 이하 25px, 650px 이하 24px | `.tower-metric strong` |
| 섹션 제목 | 13px / 600 | `.tower-section h2` |
| 본문·표 강조 | 12~13px / 400~500 | |
| 라벨·컨텍스트 | 11~12px / 400, `--muted-foreground` | `.tower-metric > span` |
| 각주·단위·보조 | 10~11px | `.tower-footnote`, `.tower-metric small` |
| 태그·배지 | 9~10px (최소 9px) | `.tower-status` |

- 굵기는 400 / 500 / 550 / 600만 쓴다. 700 이상은 쓰지 않는다.
- 섹션 제목보다 큰 글자는 페이지 제목과 KPI 숫자뿐이다. 카드 안의 숫자는 15~21px 범위로 둔다.
- 단위는 숫자 뒤 `<small>`로 작게 쓴다: `1,234,567 <small>t</small>`. 단위 표기는 SPEC·데이터 사전을 따른다(t, kcal/kg, MW, %, KST).

### 3.5 간격·모서리

| 항목 | 값 |
|---|---|
| 페이지 세로 간격 `.tower-page` | 24px (650px 이하 18px) |
| 섹션 내부 padding | 20px (650px 이하 16px) |
| 섹션 헤더 아래 | 20px |
| 2열 그리드 간격 `.tower-two` | 20px |
| 작은 요소 간격 | 4 / 6 / 8 / 12 / 16px 중에서 선택 |
| radius | 4px(배지), 5px(입력·세그먼트·메뉴), 7px(섹션), 9px 이상은 쓰지 않음 |
| 그림자 | 없음(`--shadow: none`). 세그먼트 선택 상태의 `0 1px 3px #0000000c`만 예외 |

---

## 4. 화면 구성 패턴

### 4.1 기본 골격

모든 기능 화면은 같은 순서로 구성한다.

```tsx
import { Section, Metric } from "@/components/tower/primitives";

<div className="tower-page">                 {/* 세로 24px 간격 */}
  <div className="tower-context">…기준 시각·데이터 출처…</div>
  <div className="tower-kpis">               {/* 3열, 선으로 구분 */}
    <Metric label="현재 재고" value={n(stock)} unit="t" note="Pile 합계 기준" />
    …
  </div>
  <Section title="재고 전망" note="입하 예정 반영, KST">
    <TowerChart … />
  </Section>
  <div className="tower-two">                {/* 1100px 이하 1열 */}
    <Section title="…">…</Section>
    <Section title="…">…</Section>
  </div>
</div>
```

### 4.2 공통 컴포넌트 우선

| 필요 | 사용 | 하지 않을 것 |
|---|---|---|
| 섹션 박스 | `Section` (`components/tower/primitives`) | 화면 안에 `function Section` 재정의 |
| KPI | `Metric` + `.tower-kpis` | 그라데이션·컬러 KPI 카드 |
| 차트 | `TowerChart`, `chart-options.ts` | 화면별 색 배열·축 스타일 |
| 표 | `.tower-table-wrap` + `.tower-table` | 줄무늬·진한 헤더 배경 |
| 상세 정보 | `.tower-details` (dl/dt/dd) | |
| 상태 | `.tower-status`, `.tower-tag` | 채워진 알약 배지 |
| 버튼·선택·탭·다이얼로그 | `src/components/ui/` (shadcn, new-york) | 직접 만든 버튼 스타일 |
| 기간·모드 전환 | `.segmented` | |
| 아이콘 | `lucide-react`, 기본 15~16px, stroke 1.6~2 | 다른 아이콘 세트·이모지 |

공통 컴포넌트가 부족하면 기능 폴더에서 감싸서(wrapper) 쓰고, 여러 화면에서 필요해지면 `src/components/`로 옮기는 PR을 따로 올린다.

### 4.3 데이터 표시

- 숫자 포맷은 `src/lib/format.ts`의 `number`, `date`를 쓴다. 값이 없으면 `미확정` 또는 `–`로 표시하고 0으로 바꾸지 않는다.
- 현재값과 전망값을 같은 형식으로 섞지 않는다. 전망은 라벨에 "전망/예측"을 쓰고 차트에서 점선으로 그린다.
- 가정·추정값에는 `--amber` 글자로 "가정" 표기를 붙인다.
- 더미·모의 데이터에는 `.tower-context` 또는 섹션 `note`에 "더미 데이터", "모의 위험도"처럼 표시한다.

---

## 5. 라이트/다크·반응형

- 테마는 `<html class="dark">`로 전환된다(App.tsx). 기능 CSS에 `.dark` 전용 규칙이 필요하면 토큰을 쓰지 않는 값이 있다는 뜻이다. 먼저 토큰으로 바꿀 수 있는지 확인한다.
- ECharts처럼 CSS 변수를 직접 읽지 못하는 곳만 `theme` prop으로 분기한다(TowerChart 방식).
- 브레이크포인트는 다음 값만 쓴다.

| 폭 | 변화 |
|---|---|
| ≤ 1250px | 본문 padding 축소, 상단 breadcrumb 숨김 (index.css) |
| ≤ 1100px | `.tower-two` 1열, KPI 숫자 25px |
| ≤ 1050px | 구형 `.kpi-grid` 2열, `.overview-primary` 1열 |
| ≤ 760px | 모바일 셸(상단바 축소, 모바일 메뉴) |
| ≤ 650px | KPI 2열, 섹션 padding 16px |

- 320px 폭까지 가로 스크롤 없이 보이게 한다. 넓은 표는 `.tower-table-wrap` 안에서만 가로 스크롤한다.
- 포커스 링: `outline: 2px solid` + `outline-offset 3~4px`, 색은 `--primary`.

---

## 6. 하지 말 것

| 금지 | 이유 | 대신 |
|---|---|---|
| `linear-gradient` 배경 | 원칙 1. 다른 화면과 톤이 갈린다 | `--card` + 1px `--border` |
| 진한 남색·브랜드색 헤더 바 | 셸 상단바와 위계 충돌 | `Section` 제목 13px |
| 기능 CSS의 hex 직접 사용 | 다크 모드 깨짐, 화면 간 불일치 | §3 토큰. 상태색은 §3.3 |
| 새 계열 색(`#248df5`, `#eea628` 등) | 차트 팔레트 이탈 | §3.2 순서 |
| `box-shadow` 카드 | `--shadow: none` 정책 | 선과 여백 |
| font-weight 650 이상 | 위계 과잉 | 600 이하 |
| radius 9px 초과 | 셸과 불일치 | 7px |
| 화면 안 `Section`/`Metric` 재정의 | 공통 수정이 반영되지 않음 | primitives import |
| 전역 요소 선택자 수정 | 다른 화면이 바뀐다 | 기능 접두어 클래스(`.plant-…`, `.yard-…`, `.vessel-…`) |

외부 레퍼런스(기존 사내 대시보드 등)를 재현해야 할 때도 **배치·정보 구성만 가져오고 색·장식은 이 문서를 따른다.** 레퍼런스 색을 그대로 써야 하는 요구가 있으면 PR에 이유를 적고 팀이 결정한다.

---

## 7. AI·작성자 체크리스트

UI 변경 PR 전에 확인한다.

- [ ] 새로 쓴 색이 모두 토큰 또는 §3.2·§3.3 표의 값인가? (`grep -nE "#[0-9a-fA-F]{3,8}" <변경한 css/tsx>`)
- [ ] `gradient`, `box-shadow`, `font-weight: 7xx`를 추가하지 않았는가?
- [ ] `Section`, `Metric`, `TowerChart`, `ui/` 컴포넌트를 재사용했는가?
- [ ] 라이트·다크 양쪽에서 확인했는가? 기능 CSS에 `.dark` 규칙을 새로 추가하지 않았는가?
- [ ] 1100 / 650 / 320px 폭에서 깨지지 않는가?
- [ ] 상태를 색과 글자로 함께 표시했는가? 더미·모의 데이터 표기가 있는가?
- [ ] 기능 CSS 클래스에 화면 접두어를 붙였는가?
- [ ] `npm test`, `npm run build`, `npm run test:ui`를 실행했는가?

---

## 부록 A. 현재 알려진 편차 (2026-10-09 기준)

이 문서 작성 시점에 기준과 다른 곳이다. 담당자를 탓하려는 목록이 아니며, 화면 담당자가 일정에 맞춰 정리할 때 참고한다. 각 항목의 정리 여부는 해당 화면 담당자가 정한다.

| 파일 | 내용 | 기준 |
|---|---|---|
| `src/features/plant/fuel-dashboard.css` | hex 직접 사용 58건, `linear-gradient` 5건, `.dark` 개별 규칙 16건. 남색 헤더(`.fuel-reference-header`, `.fuel-group > header`), 그라데이션 KPI·패널(`.fuel-supply-kpi`, `.fuel-panel`, `.fuel-flow-stage`), 채워진 위험도 배지(`.fuel-risk`) | §1, §3, §6 |
| `src/features/plant/FuelSupplyOverview.tsx` | 호기 그룹·차트 색을 화면에서 별도로 정의함(`#248df5`, `#eea628`, `#30b77b` 등) | §3.2 |
| `src/features/plant/FuelDashboard.tsx`, `MidtermDashboard.tsx` | `Metric`, `Section`을 화면 안에서 다시 정의함 | §4.2 |
| `src/features/stockyard/stockyard.css` | 위험도 색 hex 직접 사용 | §3.3 (토큰 도입 후 교체) |
| `src/App.tsx` | `meta theme-color`가 이전 teal 배경값(`#f5f7f8`/`#0d171b`)을 사용함 | §3.1 (`#fcfcfb`/`#19191c`) |
| `src/index.css` | refinement.css가 덮어쓰는 이전 teal 토큰이 남아 있음 | 정리 시 통합 담당자 리뷰 |

참고로 `plant.css`, `midterm.css`, `data.css`, `models.css`는 대부분 토큰과 tower 공통 스타일을 사용하고 있어 기준에 가깝다.
