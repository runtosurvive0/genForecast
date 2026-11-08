export const pageIds = ['overview','vessels','berth','yard','blend','units','simulation','procurement','costs','data','connections','members','inventory','fuel','schedule','scenario','models','demo-control'] as const;
export type Page = typeof pageIds[number];
export type PageGroup = 'operations' | 'planning' | 'data' | 'admin';
export const pageInfo: Record<Page, { label: string; sub: string; group: PageGroup }> = {
  overview: { label: '운영 개요', sub: '재고와 입하, 발전 전망을 하나의 흐름으로 확인합니다.', group: 'operations' },
  vessels: { label: '항차·화물', sub: '선박 관측과 등록 화물의 도착·하역 일정을 확인합니다.', group: 'operations' },
  berth: { label: '접안·하역', sub: '부두에서 저탄장까지 연결 설비와 물량의 이동을 확인합니다.', group: 'operations' },
  yard: { label: '저탄·재고', sub: '적치 위치와 재고, 설비의 운전 상태를 확인합니다.', group: 'operations' },
  blend: { label: '상탄·혼탄', sub: '원탄의 성상과 배합 조건을 비교하고 투입안을 검토합니다.', group: 'operations' },
  units: { label: '호기·연소', sub: '호기별 발전 계획과 연료 사용량을 연결해 확인합니다.', group: 'operations' },
  simulation: { label: '통합 시뮬레이션', sub: '저장된 발전·수급 계획을 비교하고 구매 시점을 검토합니다.', group: 'planning' },
  procurement: { label: '구매 검토', sub: '시뮬레이션 결과에서 입하 시점·저장 여력·사용 기간을 확인합니다.', group: 'planning' },
  costs: { label: '계획·실적 분석', sub: '입하·소비·재고의 계획과 확인 가능한 실적을 비교합니다.', group: 'planning' },
  data: { label: '데이터 워크스페이스', sub: '원천 자료, 계산 입력과 데이터 품질을 관리합니다.', group: 'data' },
  connections: { label: '연결·수집', sub: 'ZGX 조회와 별도 운전 모사 스트림의 연결 상태를 확인합니다.', group: 'admin' },
  members: { label: '사용자·권한', sub: '공용 ZGX 계정의 가입 승인과 접근 권한을 관리합니다.', group: 'admin' },
  inventory: { label: '재고 원장', sub: '화물별 Pile 적치와 수기 잔량을 관리합니다.', group: 'data' },
  fuel: { label: '수급 원장', sub: '기준 재고·입하 배분·소비와 수급 전망을 조회합니다.', group: 'operations' },
  schedule: { label: '발전기 정지계획', sub: '계획정지와 연료 부족 예측을 구분해 확인합니다.', group: 'planning' },
  scenario: { label: '시나리오 분석', sub: '시연 조건에서 부하와 입항 지연에 따른 영향을 비교합니다.', group: 'planning' },
  models: { label: '예측·모델', sub: '기준 모델의 검증 결과와 학습 상태를 확인합니다.', group: 'data' },
  'demo-control': { label: '운전 모사 조작반', sub: '격리된 로컬 WebSocket 서버로 운전 값을 모사합니다.', group: 'admin' },
};
export const menuGroups: { id: PageGroup; label: string; pages: Page[] }[] = [
  {id:'operations',label:'운영',pages:['overview','vessels','berth','yard','blend','units']},
  {id:'planning',label:'계획·분석',pages:['simulation','costs','schedule','scenario']},
  {id:'data',label:'데이터',pages:['data','models','inventory','fuel']},
  {id:'admin',label:'관리',pages:['connections','members']},
];
export function pageFromHash(hash: string): Page {
  const value = hash.replace(/^#/, '').split('?')[0];
  if (value === 'voyages') return 'vessels';
  if (value === 'stockyard') return 'yard';
  if (value === 'fuel-ledger') return 'fuel';
  return (pageIds as readonly string[]).includes(value) ? value as Page : 'overview';
}
export const pageHash = (page: Page): string => '#' + (page === 'vessels' ? 'voyages' : page === 'fuel' ? 'fuel-ledger' : page);
export const pageGroup = (page: Page): PageGroup => pageInfo[page].group;
