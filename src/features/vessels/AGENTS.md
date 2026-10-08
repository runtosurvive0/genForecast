# 선박 추적 담당 AI

- 루트 AGENTS.md의 Git·검증·PR 규칙을 따른다.
- 주 수정 파일: VesselTracking.tsx·VesselMap.tsx와 두 CSS 파일. 새 전용 컴포넌트도 이 폴더에 둔다.
- 지도·화물·AIS 최신성·ETA를 담당한다. src/components/ui/world-map.tsx는 공통 기반이다. AIS 비밀키는 브라우저에 넣지 않으며 실제 연결 전 더미 데이터임을 명시한다.
- 다른 features 폴더를 직접 import하지 않는다. 공통 계산·타입·App·전역 CSS 변경은 PR에 표시하고 통합 담당자 검토를 받는다.
- 지도 선택·줌·키보드, 200척 입력, 발전소 범위, 오래된 AIS, 하역 완료와 입하량을 확인한다. npm test, npm run build, UI 변경 시 npm run test:ui를 실행한다.
- 라이트/다크와 반응형, 상단바·사이드바 구조를 유지한다.
