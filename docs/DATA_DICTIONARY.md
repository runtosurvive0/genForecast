# SPEC v0.1 페이지 데이터 계약

기준시각 `2026-10-06T09:00:00+09:00`. 모든 데이터는 합성 표본이며 운영 자료가 아니다. 원본 `SPEC.md`는 수정하지 않았다.

## 식별자와 원천

- 발전소 내부 `Plant.id`는 API의 `plant_id`와 동일 값이다. 당진 `dangjin`, 보령 `boryeong`, 하동 `hadong`, 동해·삼척 `donghae`.
- `src/data/control-tower.ts`의 `Stockpile.stockpile_id`, `plant_id`, `on_hand_t`, `calorific_value_kcal_kg`, `moisture_pct`, `ash_pct`, `sulfur_pct`, `stacked_at`, `temperature_c`, `co_ppm`, `eligible_unit_ids`가 Pile 원장이다. 센서 두 필드는 null이며 위험도는 `pileRisk()`가 적치기간과 탄종만으로 계산한다.
- `Voyage.voyage_id`, `destination_plant_id`로 화물을 발전소에 연결한다. 로컬 페이지 표본은 한 항차에 한 화물이며 `cargo_t`가 API `cargo.quantity_t`에 해당한다. API DTO는 `src/domain/contracts.ts`의 CargoContract와 구분된다. 데이터 내보내기는 현재 로컬 표본 형식이다.
- MMSI `999000001` 등의 번호와 `DEMO-*` IMO는 시연용 식별자다. 지도와 상세정보는 동일한 좌표를 사용한다. 새 위치는 VesselMap의 positions 입력으로 전달하며, 알 수 없는 항차에 예시 항로를 생성하지 않는다.
- API/MILP 경계는 `src/domain/contracts.ts`, AIS Provider/decoder 경계는 `src/domain/ais.ts`. 네트워크 서비스는 실행하지 않는다.

## 단위와 시간

- 재고/화물/연료: t. 발전량: MWh 또는 GWh. 출력/용량: MW. 열량: kcal/kg. 수분/회분/황분: %. SOG: kn. COG: degree. 거리: nm.
- 일별 `date`는 09:00 KST 시작일이다. 재고는 다음날 09:00의 기말 재고이며 차트 가로축은 기말 시각 날짜를 표시한다. 입하·연료는 직전 24시간 집계다. 월 집계는 구간 시작일의 월로 묶으며 선택 기간에 포함된 구간만 합산한다.
- 하역이 전망 종료시각과 정확히 일치하면 마지막 기말 재고에 포함한다. 전망 시작 전 하역량은 현재 Pile 재고에 이미 포함된 것으로 간주한다.
- 현재 재고일수 = Pile 재고 / 첫날 예상 연료수요. 미래 재고일수 = 기말 재고 / 이후 7일 평균 계획 연료수요. 마지막 전망일을 위해 7일을 추가 계산한다. 0수요는 null(소비 없음). 최소 재고일수 날짜도 기말 시각이다.
- 실제 발전·소비는 재고로 제한하며 계획 수요는 보존한다. 발전소 간 재고를 공유하지 않는다. 혼탄 품질 변화는 아직 시뮬레이션하지 않고 현재 Pile 가중평균 열량·효율을 전망 기간에 고정한다.
- 효율 기준 환산과 heat-rate 기준 환산은 동치다. `heat_rate_kcal_kwh = 1 / (0.001163 * efficiency)`. SPEC 예시 `10000 * 2200 / 5500 = 4000 t`를 별도 검증한다.
- 현재 출력·이용률은 기준시각의 부하 표본과 계획정지를 사용한다. 미래 모델/시나리오가 현재 표본을 바꾸지 않는다. 7일 이용률은 가동 가능 시간의 정격용량을 분모로 한다. 호기 계획표는 연료 부족 전 계획값이며 실제 연료 제한 결과는 일별 재고 엔진에 반영된다.

## 모델

- 실제 로컬 경사하강법 선형회귀. 150일 train / 이후 30일 validation. 검증 표본을 gradient에 사용하지 않는다. 표시 손실은 정규화 MSE, MAE/RMSE 단위는 MW, MAPE는 %.
- 30/120/300회 반복을 선택해 재학습. 평균수요·최대수요·석탄가용용량 모델을 각각 학습한다. 마지막 관측일은 2026-10-05이며 D+1은 2026-10-06이다.
- 합성 데이터의 주기·추세 feature를 사용한다. 실제 기상·전력시장 자료와 연결되지 않았다. 예상 수요/기준 수요 및 예상 용량/기준 용량 비율을 호기 기준 부하에 곱한다. 정격용량·계획정지 제한을 적용한다. 계통 최적화가 아니다.

## AIS / ETA

- 최신성은 기준시각이 아니라 현재 컴퓨터 시각과 수신시각 차이로 계산한다: 10분 이내 LIVE, 60분 이내 RECENT, 360분 이내 ESTIMATED, 이후 STALE. 미래·잘못된 시각도 STALE. 고정된 10월 6일 표본은 시간이 지나면 모두 STALE다.
- ESTIMATED는 최신성 구분이며 이 버전은 위치 외삽을 수행하지 않는다. 지도에는 항상 마지막 표본 위치만 표시한다.
- 현재 ETA는 AIS ETA + 기상 지연 + 항로 지연 + 추가 시나리오 지연. 접안은 ETA + 항만 대기. 하역 완료 표본은 동일한 시나리오 지연만큼 이동한다. 잔여 항로거리/SOG로 ETA를 새로 계산하는 항로 모델은 후속 범위다.
- 체선료는 max(항만 대기 − 허용시간, 0) × 일 요율 / 24의 단순 예제이며 계약 정산이 아니다.
- [AISstream 공식 문서](https://aisstream.io/documentation)에 따라 키는 서버에 보관하고 브라우저 직접 연결을 하지 않는다. PositionReport decoder는 사용할 수 없는 좌표와 SOG/COG sentinel을 거른다. 서버 수집·재연결·보존은 별도 구현해야 한다.

## 현재 제공되지 않는 것

FastAPI/SQLAlchemy DB, 로그인/권한, 실제 AIS/기상/센서 연동, Python 모델 작업 관리, 실제 항로 ETA, 혼탄 변화, MILP. 이 페이지 업데이트를 전체 운영 시스템 또는 SPEC 전체 POC 완료로 간주하지 않는다.
