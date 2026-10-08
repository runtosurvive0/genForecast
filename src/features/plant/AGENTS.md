# 발전소 종합 담당 AI

- 루트 AGENTS.md의 Git·검증·PR 규칙을 따른다.
- 주 수정 파일: PlantOverview.tsx와 plant.css. 새 전용 컴포넌트도 이 폴더에 둔다.
- KPI·수급 전망·호기 출력·정지계획 진입을 담당한다. 계산 원천은 src/domain/이며 재고 엔진을 복사하지 않는다.
- 다른 features 폴더를 직접 import하지 않는다. 공통 계산·타입·App·전역 CSS 변경은 PR에 표시하고 통합 담당자 검토를 받는다.
- 발전소 선택·기간·시나리오에 따른 KPI, 현재 출력과 미래 전망의 구분, 정지계획 진입을 확인한다. npm test, npm run build, UI 변경 시 npm run test:ui를 실행한다.
- 라이트/다크와 반응형, 상단바·사이드바 구조를 유지한다.
