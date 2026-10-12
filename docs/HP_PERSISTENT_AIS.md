# ZGX 상시 AIS 수집 업데이트

서버를 시작하면 웹 접속·관심 선박 등록 없이 AISstream을 구독한다. 일반 선박 최대 40,000척과 한국행 후보 최대 1,000척의 마지막 관측을 `backend/data/vessel-discovery.sqlite3`에 저장한다. 웹 검색은 저장된 목록을 읽는다. 한국행 후보는 목적지 관측 후 72시간에 만료하며, 재시작으로 이 시간을 연장하지 않는다.

관심 선박의 과거 항적은 기존 `vessel-tracks.sqlite3`, 계정·관심 목록은 `access.sqlite3`를 계속 사용한다. 새 DB에도 비밀키는 저장하지 않는다. 모든 선박의 전체 과거 항적을 보관하는 기능은 아니다.

변경분을 5초마다 저장하고 정상 종료 시 마지막 변경을 저장한다. 저장 실패는 재시도한다. 강제 종료·디스크 장애 시 미저장분은 유실될 수 있다. 첫 업데이트 전 목록은 메모리에만 있으므로 이번 전환 시 한 번 새로 수집해야 한다. 이후부터는 저장된 목록이 재시작 후 복원된다.

## Class B 수집 보완 (2026-10-12)

기존 `PositionReport`·`ShipStaticData`에 `StandardClassBPositionReport`(18),
`ExtendedClassBPositionReport`(19), `StaticDataReport`(24)를 추가한다.
메시지 24의 유효한 A/B 부분에서 선박명·선종을 각각 합치며, 정적 정보로 위치 관측 시각을 갱신하지 않는다.
Class B에 없는 목적지·IMO·운항 상태는 만들어 내거나 기존 값을 지우지 않는다.
일반 목록 40,000척 한도와 같은 DB·지도 조회 경로를 사용한다.

ZGX에는 변경된 `backend/src/midterm/vessels/ais.py`를 배포하고 `genforecast-backend` 서비스를
재시작해야 새 구독이 적용된다. PC 코드 수정이나 브라우저 새로고침만으로는 적용되지 않는다.
기존 DB·API 키는 그대로 사용하며, 새로 수신되는 Class B 선박부터 목록에 추가된다.
AISstream에서 제공하지 않는 위치나 수집 전 과거 기록을 채워 주는 변경은 아니다.
메시지 구조는 [AISstream 공식 모델](https://github.com/aisstream/ais-message-models/blob/master/type-definition.yaml)을 따른다.

이번 패치 설치기는 `scripts/deploy/zgx-class-b.py`이며, ZGX에 전송한 업데이트 폴더에서
`update.py check`로 기존 코드 해시와 격리 테스트를 확인한 뒤 `update.py apply`로 적용한다.
`sudo` 인증 후 기존 수집기 코드를 백업하며, 재시작·상태 확인에 실패하면 코드를 복구한다.
`update.py verify`는 HTTP 상태와 DB의 마지막 수신시각 갱신을 읽기 전용으로 확인한다.
기존 `genforecast-hp-20261012` 설치 경로는 호환성을 위해 유지한다.

## 공개 웹 응답

- 기존 HTTPS 주소와 `/api` 경로를 유지한다.
- `genforecast-backend`: 기존 127.0.0.1:8093, 인증 API 및 상시 수집.
- `genforecast-frontend`: 새 127.0.0.1:8094, 지정된 공개 HTML 한 파일만 제공하며 gzip 압축한다.
- Tailscale Funnel `/`을 8094로 연결한다. `/api`는 기존 8093/api를 유지한다. 인증 API에는 압축 미들웨어를 추가하지 않는다.
- 비밀번호 기준을 8~128자로 변경한다. 기존 비밀번호와 계정은 유지되며 비밀번호를 자동 변경하지 않는다.

## 적용

`scripts/deploy/hp-persistent-ais.py`는 현재 HP 배포 경로와 `puyo` 계정 전용이다. 비밀키나 실제 DB가 없는 업데이트 묶음으로 전달한다. 다른 서버에는 그대로 실행하지 않는다.

1. PC에서 준비한 압축 파일과 SHA256 파일을 기존 SSH 연결로 HP 홈에 복사한다.
2. HP에서 SHA256을 확인하고 새 디렉터리에 `tar --keep-old-files`로 푼다.
3. 압축을 푼 폴더의 `hp-persistent-ais.py apply`를 기존 `genforecast` Python으로 실행한다. 서비스 설정 시 sudo 암호를 HP 터미널에 입력한다.
4. 설치기는 기존 원본/배포 파일의 해시를 검사하고, 분리한 소스에서 회귀 테스트를 수행한 뒤, 원본 코드·DB를 백업한다. 기존 파일이 예상과 다르면 덮어쓰지 않는다.
5. 서비스를 재시작하고 HTTPS·gzip·로그인 보호·CSRF·쿠키·비공개 경로를 검사한다. 적용 과정 실패 시 이전 코드와 파일 서빙 경로로 복구한다. DB와 비밀키 파일은 교체하지 않는다.
6. 카탈로그 API를 호출하지 않고 DB의 마지막 수신 시각 변화를 확인한다. 12초 동안 메시지가 없으면 수집 성공으로 처리하지 않고 점검 안내를 출력한다.

기존 `setup-genforecast-https.sh prepare/publish/private`는 루트를 파일로 되돌리므로 새 구성에서는 사용하지 않는다. 이번 업데이트는 이미 공개한 Funnel만 변경하며 비공개 서버를 새로 공개하지 않는다. 외부 회선의 체감 속도는 휴대폰 모바일 데이터에서 별도로 확인한다.

## 점검과 복구

업데이트 폴더에서 다음 명령을 각각 실행할 수 있다.

```bash
python hp-persistent-ais.py verify
```

```bash
systemctl is-active genforecast-backend genforecast-frontend
```

복구는 설치기가 출력한 백업 경로를 넣어 `python hp-persistent-ais.py rollback <백업 경로>`로 실행한다. 새 변경이 있으면 자동으로 덮어쓰지 않는다. DB는 이전 상태로 되돌리지 않으므로 업데이트 후 가입·관측 기록도 보존한다. 복구 후 기존 방식의 서버 수집/비압축 파일 응답으로 돌아간다.

인터넷 공개를 끄려면 별도로 `sudo tailscale funnel --https=443 off`를 사용한다. 이 명령은 HTTPS 제공 자체를 끄므로 평상시 업데이트 명령이 아니다.

코드·로컬 검증과 HP 적용 여부를 구분한다. 설치 결과를 확인하기 전까지 HP 반영 완료로 간주하지 않는다.
