---
name: "gen4cast"
description: "관측과 계획을 함께 검토하는 발전 연료 운영 워크스페이스"
colors:
  primary: "#2447c5"
  operating-blue: "#2447c5"
  active-rail-ink: "#2447c5"
  primary-dark: "#6b94ff"
  workspace: "#edf1f6"
  surface: "#fff"
  ink: "#172333"
  quiet: "#5a6a80"
  line: "#d8e1ed"
  selection: "#e9f1ff"
  rail-label: "#dce7ff"
  workspace-dark: "#17181b"
  surface-dark: "#222428"
  ink-dark: "#eef0f4"
  quiet-dark: "#aaafb9"
  line-dark: "#373b44"
  selection-dark: "#222d4a"
  header-dark: "#111214"
  scene-surface: "#e8eff4"
  scene-ink: "#344b5e"
  scene-surface-dark: "#222428"
  scene-ink-dark: "#eef0f4"
  caution: "#956319"
  caution-dark: "#dbb573"
  danger: "#bb5555"
  danger-dark: "#e99090"
  auth-visual: "#032fd9"
  auth-visual-dark: "#172e78"
typography:
  brand:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "27px"
    fontWeight: 500
    letterSpacing: "-1px"
  headline:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.4
  workspace-title:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 550
  body:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "-0.15px"
  workspace-body:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "13px"
  label:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "12px"
  source-label:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "11px"
    lineHeight: 1.5
  metric:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  rail-metric:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "43px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-1px"
  dimension:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "15px"
    letterSpacing: "0px"
  auth-intro:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "clamp(32px, 3.3vw, 46px)"
    fontWeight: 650
    lineHeight: 1.22
    letterSpacing: "-0.055em"
  auth-title:
    fontFamily: "Pretendard, 'Malgun Gothic', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "-0.04em"
rounded:
  source-tag: "3px"
  scene-control: "4px"
  field: "5px"
  action: "6px"
  selector: "7px"
  scene: "8px"
  navigation: "9px"
  retained-section: "10px"
  panel: "12px"
  shell: "16px"
  pill: "20px"
  group-tab: "24px"
spacing:
  step-4: "4px"
  step-6: "6px"
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-14: "14px"
  step-16: "16px"
  step-18: "18px"
  step-20: "20px"
  step-24: "24px"
components:
  button-workflow:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.quiet}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  button-workflow-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  button-demo-primary:
    backgroundColor: "{colors.operating-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.workspace-body}"
    rounded: "{rounded.action}"
    padding: "7px 9px"
  input-workspace:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "5px 9px"
    height: "36px"
  navigation-stage-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.active-rail-ink}"
    typography: "{typography.workspace-body}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
    height: "39px"
  card-operations:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  source-strip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.quiet}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: "12px 16px"
  scene-toolbar:
    backgroundColor: "{colors.scene-surface}"
    textColor: "{colors.scene-ink}"
    padding: "8px 10px"
  auth-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.retained-section}"
    padding: "34px"
    width: "100%"
---

# Design System: gen4cast

## Overview

**Creative North Star: "연료 운영 워크스페이스"**

gen4cast는 연료 흐름의 관측과 계획을 함께 읽는 산업 운영 작업면이다. 회색 바탕 위에 흰 정보 영역을 놓고, 파란 왼쪽 운영 패널이 출력·재고·접안과 이동 경로를 계속 유지한다. 브랜드의 Newsreader와 본문의 Pretendard는 높은 정보 밀도 안에서 서로 다른 역할을 맡는다.

장면이 필요한 화면은 실제 React/Three.js 상호작용을 중심에 둔다. 참고 형상, 사진 판독 재고, 합성 계획, 명시적으로 연결한 운전 모사와 ZGX 관측·저장 계획의 출처를 가까이에 적어 시각적 완성도가 사실의 확실성을 대신하지 않게 한다.

**Key Characteristics:**

- 회색 작업면·파란 운영 패널·흰 정보 영역과 짙은 회색 다크모드.
- 고정된 운영 맥락, 중앙 설비 장면, 간결한 재고·선택 상세의 위계.
- 자체 호스팅 브랜드 글꼴과 표 숫자의 일정한 자릿폭.
- 작은 화면의 세로 읽기 순서와 명시적인 연결·미확정 상태.

이 문서는 사용자가 승인한 운영 디자인을 실제 통합 코드에서 추출한 기록이다. 기존 보라색 강조·184px 사이드바·파란 패널 금지 규칙을 대체하며, 기능·인증·데이터 계약과 공통 컴포넌트 재사용 원칙은 유지한다. 토큰의 원천은 `src/refinement.css`와 `src/components/operations-shell/operations-shell.css`, 화면별 규칙은 각 기능 CSS다. `src/index.css`의 이전 색 값은 덮어쓰기 전 기본값이다. 문서는 팀 약속이며 새 lint·CI 강제를 추가하지 않는다.

검토 기준은 `PRODUCT.md`, `docs/GEN4CAST_UI_INTEGRATION.md`, 해당 통합 계획과 2026-11-05의 데스크톱·모바일·다크 캡처다. 문서와 캡처가 실제 운영 데이터 검증 또는 배포 완료를 뜻하지 않는다.

## Colors

파랑은 동작과 운영 맥락을, 중성색은 정보의 읽기 순서를 담당한다. frontmatter가 토큰 값을 소유하고 아래 설명은 사용 역할을 기록한다.

### Primary

- **동작 파랑**(`primary`): 링크·선택·포커스·재고 스트립. 다크모드는 `primary-dark`를 사용한다.
- **운영 패널 파랑**(`operating-blue`): 왼쪽 운영 패널과 조작반 시계 영역. 셸 패널은 두 테마에서 같은 파랑이다.
- **선택 메뉴 파랑**(`active-rail-ink`): 파란 패널 안 흰 선택 메뉴의 글자. 보조 글자는 `rail-label`이다.
- **옅은 선택면**(`selection`): 공통 선택 상태. 저탄·접안은 primary 9%와 card, 운영 워크스페이스는 primary 8%와 card를 `color-mix(in srgb, ...)`로 섞는다. 테마별 고정 밝은색으로 바꾸지 않는다.

- **로그인 흐름도 파랑**(`auth-visual`·`auth-visual-dark`): 복원된 로그인 소개의 흐름도에만 쓰는 범위 한정 토큰이다. 로그인 화면은 현재 gen4cast 워드마크와 Pretendard를 사용한다.

### Secondary

- **주의·오류 잉크**(`caution`, `danger`, dark 대응값): 의미를 전달하는 상태 문구와 함께 사용한다.
- `TowerChart.tsx`의 기본 계열은 파랑·녹색·갈색·회색 순서다. `operations-charts.css`의 재고선·정지선은 별도 teal/amber 의미 체계다. 이 계열색을 전역 브랜드색으로 확대하지 않는다.
- 이격은 별도 상태색을 사용한다. 기준 미달만 붉은색이며, 미확인·수신 지연은 중성색과 점선으로 구분한다.

### Neutral

- `workspace` 위에 `surface`를 놓고 `ink`, `quiet`, `line`을 함께 적용한다.
- 다크모드는 각 dark 대응값을 사용한다. 상단바는 `header-dark`의 짙은 회색이다.
- Three.js 장면은 `scene-surface`, `scene-ink`와 dark 대응값을 사용한다. 금속·석탄·물은 설비 재질이며 일반 UI의 새 팔레트가 아니다.

**The Operating Context Rule.** 파란 운영 패널은 제품의 지속적인 맥락이다. 선택 메뉴는 흰 면과 파란 글자로 구분하고, 일반 콘텐츠 전체를 같은 파랑으로 채우지 않는다.

**The Evidence Beside Values Rule.** 계획·사진 참고·합성·운전 모사·실제 관측의 출처를 값 또는 장면 가까이에 유지한다. 색만으로 출처나 상태를 전달하지 않는다.

## Typography

**Display Font:** Newsreader, Georgia, serif — 자체 호스팅 Medium 워드마크.

**Body Font:** Pretendard, Malgun Gothic, system-ui, sans-serif — 자체 호스팅 variable 글꼴. 셸 내부의 실제 폴백은 Malgun Gothic, sans-serif다.

**Character:** 브랜드는 세리프, 조작면은 조밀한 산세리프다. 숫자는 셸·지표·표에서 tabular-nums를 사용한다. 별도 장식용 display 또는 mono 글꼴은 없다.

### Hierarchy

- **Brand:** `brand`; 모바일 셸은 24px. `src/assets/brand/newsreader-medium.ttf`와 `PretendardVariable.woff2`를 font-display: swap으로 읽는다.
- **Headline:** `headline`; 접안·저탄·운영 화면은 모바일 22px, 유지된 공통 페이지 제목은 모바일 셸에서 23px이다.
- **Title:** 장면 섹션은 `title`, 분석 섹션은 `workspace-title`이다.
- **Body / Label:** 기본 `body`, 운영 `workspace-body`, 조작·표 `label`과 출처 `source-label`을 구분한다.
- **Metric:** 접안·저탄 `metric`, 운영 워크스페이스 29px/500, 왼쪽 출력 `rail-metric`. 모바일 접안·저탄은 22px, 워크스페이스는 23px이며 줄바꿈을 허용한다.
- **Dimension:** 이격값은 `dimension`이다. 경고를 작은 치수 글자만으로 전달하지 않는다.

- **Auth:** 복원된 소개 제목은 `auth-intro`, 로그인 폼 제목은 `auth-title`이다. 모바일 600px 이하에서 각각 30px·21px이며, 이 큰 소개 제목을 운영 화면의 조밀한 섹션에 확대 적용하지 않는다.

**The Brand Has One Voice Rule.** Newsreader Medium은 gen4cast 워드마크에 사용한다. 조작, 한국어 본문, 표와 수치는 Pretendard를 사용한다.

## Layout

데스크톱 상단바는 높이 64px·좌우 여백 24px이다. 운영 패널은 좌측 20px·상단 80px·하단 20px에 고정되고 폭은 260px이다. 본문은 왼쪽 300px에서 시작하며 위 86px·오른쪽 24px·아래 24px 여백을 갖는다. 셸이 이 값을 소유한다.

1920×1080의 접안·저탄은 제목 → 가로 KPI → 중앙 장면과 선택 상세 → 재고/일정 → 출처를 한 화면에 담는다. 행 간격은 12px, 주요 열 간격은 14px이다. 저탄 장면 오른쪽은 296px, 접안 상세는 320px이다. 큰 화면의 장면 페이지는 viewport에 맞추지만 계정 오류가 있으면 세로 흐름을 열어 경고를 가리지 않는다. 데이터·분석·관리 화면은 긴 내용을 계속 스크롤한다.

| 조건 | 구현된 변화 |
|---|---|
| 1499px 이하 셸 | 패널 232px·좌측 16px, 본문 왼쪽 268px. 보조 브랜드·모드 문구 생략 |
| 1500px 이하 접안·저탄 | 고정 높이를 해제하고 자연스러운 세로 흐름 사용 |
| 1250px 이하 워크스페이스 | 상세 열을 아래로 이동, 입력 3열 |
| 1100px 이하 접안·저탄 | 장면·상세 세로화, KPI 2열 |
| 900px 이하 셸 | 고정 패널을 모바일 메뉴로 이동, 본문 좌측 여백 해제, 상단 그룹 숨김 |
| 850px 이하 워크스페이스 | 비교 패널 세로화, KPI 2열 |
| 640px 이하 장면 | 도구막대 줄바꿈, 더미 선택을 별도 줄에 배치 |
| 600px 이하 운영 화면 | 단일열 상세, 본문·표 글자 확대, 주요 선택·입력 높이 44px, 표 안 스크롤 |
| 480px 이하 셸 | 상단바 98px, 본문 위 여백 113px. 운전 데모·연결 상태가 둘째 줄에 보임 |

관찰된 공통 간격은 frontmatter의 4–24px 단계를 재사용한다. 정보 패널의 내부 여백은 내용에 따라 14–20px이다. 유지된 정지계획·시나리오 패널은 좌우·아래 20px, 패널 간 16px이며 모바일 좌우는 16px이다. 작은 화면을 한 페이지에 맞추려고 정보를 축소하지 않는다.

운전 모사 조작반은 216px 시계 열을 사용한다. 1700px 이상에서는 240px, 1300px 이하에서는 190px, 1050px 이하에서는 위쪽 행, 720px 이하에서는 단일열 조작으로 바뀐다. 이 보조 화면의 breakpoint는 공통 셸을 대체하지 않는다.

로그인 화면은 운영 셸과 별도인 소개·인증 2열이다. 상단·하단의 최대 폭은 1320px, 본문은 1220px이며 오른쪽 폼은 370–430px, 열 간격은 clamp(48px, 8vw, 112px)이다. 왼쪽에는 소개와 파란 업무 흐름도, 오른쪽에는 실제 로그인·가입 폼을 둔다. 900px 이하에서는 최대 640px 단일열로 바꾸고 폼을 먼저 표시한다. 600px 이하에서는 화면 여백 16px·폼 여백 22px로 줄인다.

## Elevation & Depth

깊이는 작업면과 정보면의 명도 차이, 여백, 얇은 구분선으로 표현한다. 일반 셸·정보 패널은 그림자가 없다. 실제 3D 장면의 조명·재질은 시설의 공간 관계를 보여 주며 정보 카드의 장식적 그림자와 별개다.

### Shadow Vocabulary

- **Flat panel:** `box-shadow: none` — 공통 운영 정보면.
- **Selected segment:** `0 1px 3px #0000000c` — 유지된 기간·세그먼트 선택면.
- **Online signal:** `0 0 0 3px #ffffff20` — 운영 패널 연결 표시. 카드 elevation으로 재사용하지 않는다.
- 장면 text-shadow는 기하 위 가독성을 위한 halo다. 이격 치수를 떠 있는 카드로 만들지 않는다.

**The Surface Before Shadow Rule.** 패널의 경계는 작업면과 정보면의 명도 차이, 간격과 얇은 구분선으로 만든다. 일반 운영 카드에 장식용 그림자를 추가하지 않는다.

## Shapes

큰 면은 부드럽게, 조작부는 작고 명료하게 구분한다. 셸·기존 공통 패널은 16px, 접안·저탄·운영 패널은 12px, 유지된 분석 섹션은 10px이다. 메뉴 선택 9px, 장면 8px, 세부 선택 7px, 입력 5px이 대표값이다. 그룹 메뉴와 워크플로 탭은 각각 24px·20px이다. 출처 태그·장면 조작은 3–4px이다.

표는 얇은 가로 구분선을 사용하고 선택 행은 옅은 파란 혼합면이다. 일정의 반복선과 제한 영역은 데이터 표식이므로 배경 그라데이션 일괄 금지 대상으로 삼지 않는다. 이격 치수는 박스 없이 1px 측정선과 작은 값으로 표시한다.

## Components

### Buttons

워크플로 버튼은 흰 배경과 얇은 테두리, 선택 시 primary와 흰 글자를 사용한다. 경로 이동은 조용한 텍스트와 Lucide 화살표이며 hover에서 primary가 된다. 조작반 주 버튼은 운영 패널 파랑이다. disabled는 조작을 막고 낮은 불투명도로 구분한다.

키보드 포커스는 보통 primary 2px outline과 3–4px 간격이다. 장면·조작반의 자체 파란 focus와 기존 shadcn ring 변형을 유지한다. 선택 의미는 aria-pressed/aria-selected/aria-current에 남긴다.

### Chips

제목 옆 출처는 작은 테두리 태그다. 운전 데모는 checkbox와 상태 텍스트가 있는 조작부이며 장식 status chip이 아니다. 모바일에서도 조작·상태를 함께 유지한다.

### Cards / Containers

패널은 card 면을 사용하고 제목·표·상세가 같은 영역에 연결된다. 필요한 장면·표만 overflow를 제어한다. KPI는 하나의 가로 면에서 선으로 나눈다. 좁은 화면의 넓은 표는 자체 스크롤, sticky 헤더는 card 색을 사용한다.

### Inputs / Fields

구매 검토 입력은 얇은 border, card 배경, 5px 모서리, 36px 높이이며 600px 이하에서는 44px이다. 조작반은 별도 6px 입력·버튼 체계를 쓴다. placeholder·보조 라벨은 muted-foreground, 값은 foreground다. 오류·미확정 문구를 유지한다.

### Navigation

상단 그룹·왼쪽 운영 단계·보조 메뉴는 실제 앱 경로에 연결된다. 운영 단계는 13px 글자·39px 이상 행, 흰 선택면과 파란 잉크다. 보조 메뉴는 작은 2열이다. 모바일에서는 동일 메뉴를 파란 메뉴로 옮기고 중복 고정 지표를 감춘다. 테마·계정 아이콘은 현재 foreground로 다크모드 대비를 유지한다.

### Shared Facility Scene

`FuelScene`은 공유 React/Three.js 구성요소다. 100–1200% 확대, 드래그·방향키 이동, Home 원위치, 더미 선택·선택 확대를 제공한다. 지붕 투시는 해당 부두·옥내 저탄장에 제공한다. 장면 밖 select·재고 표와 상세 선택을 연결한다. hover 안내는 얇은 테두리의 작은 설명이고 이격 치수 자체에는 상자를 두지 않는다.

형상·이격 추정과 사진 출처를 장면 하단에 유지한다. 미확인 기준은 판정하지 않고 1저탄장 사용 제한은 기존 참고 재고 위에 겹친다. 연결된 모사는 같은 snapshot으로 장면·수치를 갱신한다. 첫 수신 전은 미확정, 끊김·지연은 마지막 값과 정지한 흐름을 표시한다. prefers-reduced-motion에서는 흐름을 멈추고 값·선택은 유지한다. WebGL 사용 불가는 안내와 더미 선택·표 대안을 남긴다.

### Source Strip and Retained Workspaces

출처·기준시각·조회 조건은 정보면 또는 제목 옆에 남긴다. 인증, AIS·관심 항차, 계획·원장·모델·정지계획·관리자는 실제 앱 기능을 유지한다. 디자인이 해당 기능의 사실·완료 상태를 새로 만들지 않는다. 아이콘은 기존 Lucide SVG 체계를 사용한다.

### Restored Authentication

로그인은 복원된 소개·흐름도·폼 구성을 유지한다. 흐름도는 8px 모서리, 폼은 10px 모서리·얇은 border·34px 내부 여백이다. 입력은 6px 모서리·38px 높이이며 비밀번호 표시 조작은 입력 오른쪽에 있다. 로그인·가입 탭과 실제 승인·오류·안내 상태는 기존 인증 기능에 연결된다. 소개 흐름도는 기능 안내이며 연결된 실시간 운전 상태를 주장하지 않는다. 제목 위 kicker·eyebrow와 작은 영문 보조 문구는 복원된 기존 표현이지만 새 화면의 반복 패턴으로 규범화하지 않는다.

## Do's and Don'ts

### Do:

- **Do** 공통 셸과 CSS 토큰을 재사용하고 기능별 선택자를 해당 기능 범위 안에 둔다.
- **Do** 흰 정보 영역과 파란 운영 패널의 역할을 유지하고 다크모드에서는 회색 작업면·정보면·밝은 글자를 함께 적용한다.
- **Do** 숫자에 tabular-nums를 쓰고 단위 t, kcal/kg, MW와 KST를 데이터 계약에 맞게 표시한다.
- **Do** 참고·합성·모사·실제 관측의 출처, 미연결, 미확정과 마지막 값 상태를 가까이에 표시한다.
- **Do** 1920×1080의 접안·저탄 화면과 작은 화면의 세로 배치를 모두 확인하고 넓은 표의 스크롤을 표 안에 둔다.
- **Do** 키보드 포커스, 장면 밖 더미 선택, 상세·원장 진입과 reduced-motion 동작을 유지한다.

### Don't:

- **Don't** API 실패나 첫 모사 수신 전 빈 값을 합성 수치 또는 0으로 채워 실제 관측처럼 보이게 하지 않는다.
- **Don't** 사진 판독 재고와 DB 처별 집계를 섞거나 개념 3D 형상을 실제 측량·센서 상태로 주장하지 않는다.
- **Don't** 작은 화면을 데스크톱 한 페이지 안에 억지로 축소하거나 운전 데모 연결 상태를 숨기지 않는다.
- **Don't** 과거 보라색 강조, 184px 사이드바, 9px 초과 모서리 금지와 파란 패널 금지를 새 화면의 기준으로 되살리지 않는다.
- **Don't** 화면마다 재고 계산·공통 내비게이션·차트 기본값을 복제하지 않는다.
- **Don't** 캡처에 남은 작은 보조 글자, 중복 토큰이나 개별 화면 편차를 새 화면의 필수 규칙으로 확대하지 않는다.

미규범화: 복원 로그인에 남은 kicker·eyebrow·작은 영문 보조 문구, 일부 조밀한 화면의 9–10px 보조 글자, index/refinement/기능 CSS의 중복된 이전 규칙, 조작반·차트의 국소 색 예외는 전역 새 화면 권장값으로 삼지 않는다. 이 문서 작업은 해당 코드를 수정하지 않으며 최종 UI 검토나 접근성 인증을 대신하지 않는다. frontmatter는 구현 토큰이며 sidecar의 tonal ramp는 미리보기용 보간이다.


### Dark action and emphasis roles

Approved 2026-11-06: charcoal canvas #17181B, cards #222428, header #111214. `--primary` #6B94FF is the readable dark-mode accent for text, icons, charts and focus. `--action` remains #2447C5 with white text for primary filled buttons and workflow selections; hover #1D3CAD. The operating rail stays #2447C5. Text on a bright primary fill uses #17181B. This distinction applies to the shared Button and both themes.

Dark emphasis refinement (2026-11-06): the dark logo uses foreground white #EEF0F4. Readable small accents use #6B94FF; charts and inventory bars use the separate `--data-blue` #4F76E6, leaving #2447C5 for the operating rail and filled actions. Light data blue stays the brand blue. Selection surface is #222D4A.

### Voyage operating workspace

항차·화물은 저탄·재고의 정보면·12px 간격·12px 모서리를 기준으로 한다. 사용자가 추가한 운송 대시보드 레퍼런스에 맞춰 왼쪽 320px 영역에 검색·상태 필터·항차 카드를, 오른쪽에 지도와 하단 도착 전망·운송 일정을 둔다. 카드는 출항지→도착지, 등록 화물·열량, 입항 전망을 보여주며 선택 카드 하단은 운영 패널과 같은 파란색이다. 카드 내용은 높이를 자르지 않고 목록 영역에서 스크롤한다. 제목과 화면 전환은 한 줄, 선택 선박 이름·MMSI·목적항·설정은 지도 위에 둔다. 기본 상태는 1920×1080 한 화면이며 자료·계산 근거를 펼치면 세로로 확장한다. 900px 이하에서는 선박 목록을 접을 수 있는 세로 배치다. 실제 AIS 목적지·기본 ETA와 등록 화물·운송 일정은 서로 대체하지 않는다. 타임라인은 출항 계획·입항·접안·하역 완료의 등록 일정이며, 값이 있다는 이유로 운전 완료 상태로 표시하지 않는다. 미등록 화물·미확정 일정은 수치로 보완하지 않는다.
