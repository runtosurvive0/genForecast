# 저탄장 담당 AI

- 루트 AGENTS.md의 Git·검증·PR 규칙을 따른다.
- 주 수정 파일: Stockyard.tsx와 stockyard.css. 새 전용 컴포넌트도 이 폴더에 둔다.
- Pile 배치·선택·상세·탄질·모의 위험도를 담당한다. Pile 합계와 발전소 KPI가 같은 데이터를 사용해야 한다. 센서 미연결 표시를 유지한다.
- 다른 features 폴더를 직접 import하지 않는다. 공통 계산·타입·App·전역 CSS 변경은 PR에 표시하고 통합 담당자 검토를 받는다.
- Pile 선택·상세, 합계와 가중 열량, 위험도 표시, 좁은 화면을 확인한다. npm test, npm run build, UI 변경 시 npm run test:ui를 실행한다.
- 라이트/다크와 반응형, 상단바·사이드바 구조를 유지한다.
