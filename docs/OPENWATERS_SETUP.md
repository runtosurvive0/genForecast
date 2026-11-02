# Open Waters 보조 수신

ZGX가 AISstream 전 세계 수집과 Open Waters 지정 해역 수집을 동시에 수행한다. 팀원은 기존대로 `npm ci`, `npm run dev`만 사용한다. 브라우저·팀원 PC에 토큰이나 별도 수신기를 설치하지 않는다.

## 활성화

서버 환경변수 `OPENWATERS_ENABLED=1`을 설정하고 백엔드를 재시작한다. 기본은 비활성이다.

- 기본 범위: `[[36.8,126.4,37.2,126.9]]` (당진·평택 주변).
- 선택 설정 `OPENWATERS_BOUNDING_BOXES`: `[남위도,서경도,북위도,동경도]` 사각형 배열. 최대 8개, 합계 100제곱도 이내. 위도/경도 순서에 주의한다.
- `OPENWATERS_API_TOKEN`: 선택적 서버 전용 토큰. 없으면 익명 범위로 연결한다. AISstream 키를 재사용하지 않는다.
- `OPENWATERS_ENABLED=0` 후 재시작하면 보조 수집만 멈춘다. 이미 저장된 관측은 원래 시각·출처로 남는다.

[공식 API](https://openwaters.io/api/ais/)는 개인용 무료/상업용 유료를 안내한다. 팀·공개 시연 및 운영 사용 범위는 서비스 이용 조건에 맞춰 운영자가 확인한다. 익명 접속 가능 여부와 재배포 허가는 별개다. 공급원 출처 링크를 유지한다. 익명 스트림은 연결 수·초당 메시지 한도가 있으므로 전 세계 수집 대신 지정 해역을 보완한다.

## 데이터 계약

기존 `source=aisstream`, `/api/vessels/catalog?provider=aisstream`, `ais-<MMSI>`는 호환용 통합 컬렉션 키를 유지한다. 새 제공처마다 계정 관심 목록과 항적을 분리하지 않는다.

- `ais.position.feed=openwaters`, `upstream=aishub` 등: 해당 위치의 실제 전달 경로. `feed` 생략은 기존 AISstream 위치이다.
- `reencoded=true`: 공급원 JSON 관측을 AIS 프레임으로 재인코딩한 중계 자료. 가상 위치·경로 외삽이 아니다.
- `ais.metadataFeed`: 위치가 없는 정적 정보의 출처. 위치가 있으면 위치 출처를 우선한다.
- 원본 메시지 정보 없는 캐시 재구성, 미래·누락 시각, 위치 sentinel은 채택하지 않는다. 정적 메시지 envelope 좌표로 위치를 만들지 않는다.
- 최신 관측 시각으로 MMSI를 병합한다. DB 구조와 12만 척 한도는 유지한다.
- `feeds.aisstream` / `feeds.openwaters`: 공급원별 연결 상태·마지막 채택 수신 시각. 하나의 정상 상태가 다른 공급원의 장애를 지우지 않는다.

## 검증과 배포

`backend/tests/test_openwaters.py`는 외부 연결 없는 회귀 테스트다. `PYTHONPATH=src python tests/probe_openwaters.py`는 명시적으로 수행하는 25초 실수신 검사이며 임시 SQLite만 사용한다.

`scripts/deploy/zgx-openwaters.py`는 배포 묶음에서 실행한다. `verify`는 운영 파일 해시·격리 테스트를 확인하며, `apply`는 정확히 허용된 세 Python 파일과 웹 빌드만 교체하고 systemd 보조 수집 설정을 추가한다. DB·계정·API 키·압축 미들웨어·Tailscale 설정을 교체하지 않는다. 사용자 sudo 입력이 필요하며 출력된 rollback 명령으로 코드/설정을 복원할 수 있다. 관측 DB를 과거 백업으로 되돌리지 않는다.
