# ZGX 자동 갱신

공용 서버 ZGX(https://zgx-6660.tailec6d33.ts.net)는 GitHub `main`의 최신 커밋을 5분마다 확인한다. GitHub 검사(`verify`, `backend`)가 통과한 커밋만 ZGX에서 다시 시험·빌드하고, 통과하면 반영한다. 반영 뒤 서비스가 정상 응답하지 않으면 이전 버전으로 되돌린다. 보통 병합 후 수십 분 안에 반영된다.

파일: `scripts/deploy/zgx-auto-update/`

| 파일 | 역할 |
| --- | --- |
| `update.py` | 갱신기(표준 라이브러리만). `deploy`, `status`, `rollback`, `check`, `seed-shared` |
| `install.sh` / `uninstall.sh` | 최초 설치 / 해제(기존 2026-10-12 설치로 복귀) |
| `systemd/genforecast-update.service`, `.timer` | 5분마다 `update.py deploy` 실행 |
| `systemd/genforecast-demo.service` | `/demo-stream` 웹소켓 서버(`scripts/fuel-demo/server.cjs`) |
| `systemd/backend-current.conf`, `frontend-current.conf` | 기존 백엔드·화면 서비스가 현재 릴리스와 그 venv로 실행되게 하는 drop-in |
| `systemd/sudoers-genforecast` | 세 서비스 재시작만 암호 없이 허용 |

## 동작 원리

ZGX의 폴더 구성:

```text
/home/puyo/genforecast/
  repo/       GitHub 저장소 clone(fetch와 git archive에만 사용)
  releases/   커밋별 릴리스(최근 3개 보관). 각 릴리스에 전용 .venv가 있다
  current ->  지금 서비스 중인 릴리스(심볼릭 링크)
  bin/        설치된 갱신기 update.py(이전 판: update.py.prev)
  state/      실패 커밋, 이전 릴리스, 재시도 횟수, 전환 중 표시(activating), 마지막 결과(last-result.json), 잠금
  shared/     runs/, inputs/ (서버가 실행 중에 만드는 계획 실행·시나리오. 릴리스 사이에 보존)
  data/       데모 모의 운전 상태 DB(operating-simulation.sqlite3, 최근 20,000행·7일만 보관)
/home/puyo/genforecast-hp-20261012/backend/data/   실사용 DB·공유 자료(그대로 사용)
/home/puyo/.config/genforecast/demo.env              데모 조작반 비상용 토큰(0600)
```

백엔드·화면 서비스는 drop-in으로 `ExecStart`를 비운 뒤 `/home/puyo/genforecast/current/.venv/bin/python`으로 다시 정의한다. 공용 Python 환경(`genforecast`)에는 아무것도 설치하지 않는다.

`update.py deploy` 순서:

1. 잠금을 잡는다. 이미 실행 중이면 종료 코드 75로 끝낸다.
2. `state/activating`이 남아 있으면 이전 실행이 전환 도중 멈춘 것이다. 먼저 세 서비스를 재시작해 현재 `current`로 다시 띄운 뒤 상태를 확인한다(옛 프로세스의 응답을 보고 새 릴리스를 받아들이지 않기 위해). 정상이면 그대로 받아들이고, 재시작 실패나 비정상이면 이전 릴리스로 되돌린 뒤(재시작 포함) 그 커밋을 실패로 기록한다.
3. `origin/main`을 받는다. 현재 커밋과 같거나, 이전에 실패한 커밋이면 끝낸다.
4. GitHub check-runs(토큰 없이 공개 API, 10초 제한)에서 `verify`와 `backend`가 모두 success인지 본다. `app.slug`가 `github-actions`인 실행만 센다(다른 앱이 같은 이름으로 올린 결과는 무시).
   - 진행 중이거나 결과가 없거나 네트워크 오류면 "대기"로 보고 종료 코드 76으로 끝낸다. 다음 주기에 다시 본다.
   - 하나라도 failure·cancelled·timed_out이면 그 커밋을 실패로 기록한다.
5. `git archive`로 `releases/<UTC시각>-<짧은커밋>`에 풀고 `REVISION`에 커밋을 적는다.
6. 의존성을 먼저 모두 설치한다.
   - 릴리스 전용 venv `PY -m venv --system-site-packages <릴리스>/.venv`를 만들고, `backend/pyproject.toml`의 의존성(+dev)을 거기에 `pip install`한다. 공용 환경에 이미 맞는 패키지는 재사용된다.
   - 이어서 `npm ci`를 한다.
7. 시험·빌드:
   - 백엔드 `pytest`는 릴리스 venv의 Python으로, 공유 DB·runs·inputs가 연결되지 않은 별도 임시 사본에서, 키·DB 경로 변수를 모두 뺀 환경으로 실행한다.
   - 화면은 `npm test`, `npm run build` 후 `dist/index.html`이 생겼는지 확인한다.
   - 갱신 서비스는 `InaccessiblePaths`로 `backend.env`, `demo.env`를 가려 시험 프로세스가 키를 읽지 못한다.
8. 공유 데이터 연결: 기존 데이터 폴더의 파일 중 그 커밋에 추적되지 않은 것(DB, `-wal`/`-shm`, `coal_units.csv` 등)만 릴리스 `backend/data/`에 링크한다. 추적되는 파일은 저장소 사본을 쓴다. 여기까지가 `--no-switch`다.
9. 전환 단계(백업부터):
   - 공유 데이터의 `*.sqlite3`를 SQLite backup API로 `~/.config/genforecast/backups/auto-<시각>/`에 복사한다(자동 백업 최근 3개, 600초 제한). 끝까지 복사한 백업에만 완료 표시 `.complete`를 남긴다. 시간 초과나 오류면 만들던 폴더를 지우고 일시 실패로 센다. 복구에 쓸 백업은 완료 표시가 있는 것 중 가장 최근 것을 고른다.
   - runs/·inputs/를 정리한다. 그 커밋에 추적된 파일은 `shared/`에 덮어쓰고, 추적되지 않은 파일은 그대로 둔다. 릴리스의 `backend/runs`, `backend/inputs`는 공유 폴더 링크로 바꾼다.
10. `state/activating`(이전·새 대상, 커밋, 시각)을 쓰고 `current` 링크를 원자적으로 바꾼 뒤 세 서비스를 재시작한다.
11. 상태 확인(최대 약 60초): 백엔드 8093(500 미만, 로그인 필요 401도 정상)과 화면 8094 `/` 200이 10초 간격으로 **두 번 연속** 정상이어야 한다. 데모 61578 `/health`는 실패해도 경고만 남기고 되돌리지 않는다.
12. 실패하면 이전 릴리스로 되돌리고 재시작·상태 확인을 한 뒤 그 커밋을 실패로 기록한다. 이전 버전으로도 정상이 아니면, 복구에 쓸 백업 폴더 경로를 로그와 `last-result.json`에 남긴다.
13. 성공이든 실패든 끝에 정리한다. 현재·직전 릴리스는 항상 남기고 3개만 보관한다. 현재·직전이 아닌 릴리스의 `node_modules`는 지운다.
14. 전환에 성공했고 새 커밋의 `update.py`가 설치본과 다르면 `bin/update.py`를 교체한다. 이전 파일은 `update.py.prev`로 남긴다. 새 파일로 `deploy --self-check`(부작용 없는 점검: import, deploy 인자 해석, 상태 읽기·판단까지. 잠금·네트워크·쓰기 없음)를 실행해 보고, 실패하면 되돌린다. 교체 중 파일 오류는 경고만 남기고 결과는 `deployed`로 기록한다.

실패 분류:

- **실패 커밋으로 기록**(같은 커밋은 다시 시도하지 않음): GitHub 검사 실패, `pyproject.toml` 읽기 오류, 백엔드 시험, `npm test`, `npm run build`, 반영 후 상태 확인 실패, 전환 중단 후 상태 확인 실패, 수동 `rollback`.
- **다음 주기에 다시 시도**: `git fetch`/`git archive`, venv 생성, `pip install`, `npm ci`, 공유 데이터 연결, 파일 작업 오류, 백업 실패·시간 초과. 같은 커밋에서 3번을 넘으면 실패로 기록한다. 준비 단계와 전환 단계(백업·공유 연결)의 실패를 함께 센다. 횟수는 준비가 막 성공했을 때, 반영에 성공했을 때, `--retry`로 그 커밋을 다시 시도할 때만 초기화한다.
- **대기**(실패 아님): GitHub 검사가 아직 끝나지 않음.

실패로 기록된 커밋은 고친 커밋이 `main`에 병합되면 그 커밋으로 넘어간다. 같은 커밋을 다시 시도하려면 `--retry`를 쓴다.

단계별 시간 제한의 최악 합계는 약 113분(6,739초)이다. 데이터 백업(600초)과, 중단 복구의 재시작·상태 확인 뒤 같은 실행에서 전환·되돌리기까지 이어지는 경우를 넣었다. 5분 여유를 더해도 서비스 `TimeoutStartSec=120min` 안에 든다(시험으로 확인). 그래도 강제 종료되면 2번 단계가 다음 실행에서 복구한다.

## main 보호 설정 (권장, 아직 적용 안 됨)

2026-11-09 확인 결과, GitHub `main`에는 브랜치 보호와 규칙 세트가 없다. 저장소는 공개다. 자동 갱신은 `verify`·`backend` 검사 통과를 확인하지만, 리뷰 없이 바로 병합하는 것까지 막지는 못한다. 저장소 관리자가 다음을 설정하기를 권장한다(이 작업에서는 GitHub 설정을 바꾸지 않았다).

- Pull request 필수, 승인 1명
- 상태 검사 `verify`, `backend` 필수, 최신 main 기준
- force push·브랜치 삭제 금지

## 데모 조작반(공개 주소) 보호

`/demo-stream`은 Funnel로 공개된다. 조회(viewer)는 누구나 할 수 있다. 조작(controller)은 **관리자 승인을 받은 앱 로그인**이면 열린다.

- 사용법: 공개 주소에 로그인한 뒤 데이터 화면의 "조작반 열기"나 `https://zgx-6660.tailec6d33.ts.net/#demo-control`을 연다. 새 탭에서도 로그인이 유지되므로 따로 할 일이 없다.
- 확인 방식: 데모 서버가 웹소켓 연결 요청의 `gf_session` 쿠키 하나만 같은 서버 백엔드 `http://127.0.0.1:8093/api/auth/session`에 넘겨 묻는다. `user`가 있고 `scope`가 `full`(승인 완료, 비밀번호 변경 완료)일 때만 연다.
  - Host는 이미 허용 목록으로 검증한 Origin에서 만든다.
  - 응답이 없거나 3초가 지나거나 형식이 다르면 거부한다.
  - 쿠키가 없으면 백엔드에 묻지 않고 거부한다.
  - 확인 주소는 `DEMO_ALLOWED_ORIGINS`가 있으면 위 주소가 기본이다. 바꾸려면 `DEMO_SESSION_URL`을 쓴다.
- 비상용 토큰: `~/.config/genforecast/demo.env`(0600)의 `DEMO_CONTROLLER_TOKEN`도 그대로 쓸 수 있다(`#demo-control?token=<값>`). 백엔드가 멈춰 로그인 확인이 안 될 때만 쓰고, 값은 대화방·문서에 붙여 넣지 않는다.
  - 토큰을 바꾸려면 파일 값을 바꾼 뒤 `sudo systemctl restart genforecast-demo.service`를 실행한다.
- 서버 제한:
  - Origin이 없는 연결이나 허용 목록 밖 Origin은 거부한다.
  - 동시 연결 상한은 역할별로 따로 둔다. 시청자 최대 100개(`DEMO_MAX_CLIENTS`), 조작반 최대 5개(`DEMO_MAX_CONTROLLERS`). 시청자가 가득 차도 조작반은 접속할 수 있다.
  - `DEMO_ALLOWED_ORIGINS`가 설정되면 토큰도 승인된 로그인도 없는 조작반 연결은 모두 거부한다(닫힌 쪽으로 실패). 시청자는 그대로 접속한다.
  - 조작 명령이 연결당 초당 5개를 넘으면 넘는 명령은 무시하고, 계속되면 연결을 끊는다.
- 배포 주소가 없는 개발 PC(`npm run demo`)에서는 지금처럼 로그인·토큰 없이 조작할 수 있다.
- 이 변경은 `scripts/fuel-demo/server.cjs`만 바꾸므로 자동 반영으로 적용된다. 서비스 파일은 그대로다.

## 최초 설치

PR이 `main`에 병합되고 GitHub 검사가 통과한 뒤, ZGX 터미널(NVIDIA Sync)에서 `puyo` 계정으로 붙여 넣는다. 처음 한 번 sudo 암호를 물을 수 있다. 시험·빌드 때문에 수십 분 걸릴 수 있다.

```bash
test -d /home/puyo/genforecast/repo/.git || git clone https://github.com/runtosurvive0/genForecast.git /home/puyo/genforecast/repo
git -C /home/puyo/genforecast/repo pull --ff-only origin main
bash /home/puyo/genforecast/repo/scripts/deploy/zgx-auto-update/install.sh
```

`install.sh` 단계(이미 된 단계는 건너뛰므로 다시 실행해도 안전). 설치하는 동안 자동 갱신 타이머를 멈추고, 진행 중인 갱신이 있으면(`ActiveState`가 `activating` 포함 실행 중이면) 끝날 때까지 기다린다. 중간에 멈추면 원래 켜져 있던 타이머만 다시 켠다.

1. conda로 Node 환경 `genforecast-node`(conda-forge `nodejs>=22.13`) 준비
2. `/home/puyo/genforecast`와 저장소 clone
3. `update.py`를 `bin/`에 복사
4. 첫 릴리스 시험·빌드만(`update.py deploy --no-switch --retry`). GitHub 검사 대기(76)나 잠금(75)이면 1분 간격으로 최대 30분 기다린다. 실패하면 여기서 멈추고 서버는 그대로다.
5. sudoers(`visudo -cf` 검사 후 0440), 서비스 파일 설치, `daemon-reload`, `genforecast-demo` 활성화, 조작반 토큰 파일 생성
6. Tailscale에 `/demo-stream` 경로를 추가한다(아래). 변경 전 설정은 `~/.config/genforecast/backups/tailscale-serve-before-autodeploy.json`에 저장한다. `/`, `/api`, `/demo-stream`과 Funnel을 확인하고, `/preview`는 변경 전에 있었을 때만 남았는지 확인한다.
7. 옛 설치의 `backend/runs`, `backend/inputs`를 `shared/`로 최초 1회 복사한다(`update.py seed-shared`, 표시 파일 `shared/.seeded`, 덮어쓰지 않음, 옛 폴더는 읽기만 함). 그다음 순서:
   1. drop-in을 설치한다.
   2. 두 서비스의 `WorkingDirectory`·`ExecStart`와 화면 서비스의 `GENFORECAST_FRONTEND_FILE`이 바뀌었는지 확인한다.
   3. `update.py deploy`로 전환·재시작·상태 확인을 한다.
   첫 전환이 실패하면 drop-in을 지우고 기존 설치(2026-10-12 폴더)로 서비스를 복구한다.
8. `genforecast-update.timer`를 켜고, 데모 조작반 사용법(승인된 로그인)을 안내한다.

### Tailscale 경로 (ZGX Tailscale 1.104.2 기준)

기존 `/`, `/api`, `/preview` 경로와 Funnel은 그대로 두고 경로 하나만 더한다.

```bash
# 추가(install.sh 6단계)
sudo tailscale funnel --bg --set-path /demo-stream http://127.0.0.1:61578/demo-stream
# 확인
sudo tailscale serve status
# 제거(uninstall.sh 5단계)
sudo tailscale funnel --set-path /demo-stream off
```

- Tailscale은 마운트 경로(`/demo-stream`)를 떼고 전달하므로 대상 주소에도 `/demo-stream`을 붙인다. 기존 `/api` → `127.0.0.1:8093/api`와 같은 방식이다.
- 443 포트에 Funnel이 켜져 있으므로 반드시 `tailscale funnel` 하위 명령으로 추가한다. 1.104.2 소스(`cmd/tailscale/cli/serve_v2.go`의 `applyFunnel`)에서는 Funnel이 켜진 포트에 `tailscale serve`로 핸들러를 더하면 그 포트의 Funnel이 꺼진다("Removing Funnel" 출력).
- `--set-path … off`는 그 경로 하나만 지운다. 같은 포트에 다른 경로가 남아 있으면 Funnel은 유지된다. `uninstall.sh`는 제거 뒤 `/`, `/api`와 Funnel이 살아 있는지 확인하고, 아니면 멈춘다.

## 상태 보기

```bash
systemctl status genforecast-update.timer
journalctl -u genforecast-update -n 50
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py status   # 마지막 결과 포함
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py check
```

`state/last-result.json`에는 매 실행의 커밋, 시각, 결과, 단계, 메시지가 남는다. 결과 값은 `deployed`, `up_to_date`, `waiting_ci`, `ci_failed`, `test_failed`, `retry_later`, `retry_exhausted`, `rolled_back`, `rollback_unhealthy`, `recovered_interrupted`, `manual_rollback` 등이다. `rollback_unhealthy`이면 `backup` 항목에 복구에 쓸 백업 폴더가 적힌다.

## 수동 실행

```bash
sudo systemctl start genforecast-update.service      # 타이머를 기다리지 않고 한 번 실행
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py deploy --self-check   # 부작용 없는 갱신기 점검
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py deploy --retry   # 실패 기록 커밋 재시도(재시도 횟수도 새로 셈)
```

## 되돌리기

```bash
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py rollback
```

이전 릴리스로 되돌리고 되돌린 커밋을 실패로 기록한다. 그래서 타이머가 같은 커밋을 곧바로 다시 올리지 않는다. 다음 새 커밋이 `main`에 들어오면 다시 자동 반영된다.

자동 갱신 전체를 해제하고 기존 2026-10-12 설치로 돌아가려면:

```bash
bash /home/puyo/genforecast/repo/scripts/deploy/zgx-auto-update/uninstall.sh
```

`uninstall.sh`는 `shared/runs`, `shared/inputs`와 `demo.env`를 지우지 않고, 옛 설치로 자동 복사하지도 않는다. 자동 갱신 기간에 새로 생긴 실행 결과·시나리오를 옛 설치에서도 보려면, 해제한 뒤 내용을 확인하고 덮어쓰지 않는 복사로 직접 옮긴다.

```bash
# 무엇이 옮겨질지 먼저 확인(바꾸지 않음)
rsync -a --ignore-existing --dry-run --itemize-changes /home/puyo/genforecast/shared/runs/ /home/puyo/genforecast-hp-20261012/backend/runs/
rsync -a --ignore-existing --dry-run --itemize-changes /home/puyo/genforecast/shared/inputs/ /home/puyo/genforecast-hp-20261012/backend/inputs/
# 확인 뒤 --dry-run을 빼고 실행. 같은 이름의 옛 파일은 덮어쓰지 않는다.
```

`rsync`가 없으면 `cp -an`을 쓴다. 저장소에 추적되는 파일(예: `inputs/ranking_oh.json`)은 옛 설치 사본이 그대로 남는다.

## 갱신 멈추기

```bash
sudo systemctl disable --now genforecast-update.timer   # 멈추기
sudo systemctl enable --now genforecast-update.timer    # 다시 켜기
```

## 주의

- `main` 병합은 공용 서버 반영으로 이어진다. 병합 전에 PR 리뷰와 CI를 반드시 거친다.
- 반영할 때 백엔드를 재시작하므로, 진행 중인 MILP 계산과 AIS 수신 연결이 끊긴다. AIS 수신은 재시작 후 다시 연결되고, 계산은 다시 실행해야 한다.
- 전환 전 데이터 백업: `~/.config/genforecast/backups/auto-<시각>/`(최근 3개).
- **DB 구조 변경은 이전 코드와 호환되게 만든다.** 코드를 되돌려도 새 코드가 바꾼 DB 구조·내용과 `shared/` 자료는 그대로 남는다. 열·표 추가처럼 이전 코드가 무시할 수 있는 변경만 하고, 필요하면 백업으로 직접 복구한다.
- 키는 `/home/puyo/.config/genforecast/backend.env`(백엔드)와 `demo.env`(조작반 토큰)에만 둔다. 갱신기는 이 파일들을 읽지 않고, 시험은 키 없이 실행한다.
- 의존성은 릴리스별 `.venv`에만 설치한다. 공용 환경 `genforecast`는 바뀌지 않지만, `--system-site-packages`로 그 패키지를 함께 쓰므로 공용 환경을 직접 바꾸면 모든 릴리스에 영향을 준다.
- `shared/runs`, `shared/inputs`는 자동 백업 대상이 아니다. 추적 파일은 전환 단계(백업 뒤)에서 덮어쓴다. 전환이 실패해 되돌려도 그 파일은 새 커밋 내용으로 남는다(추적되지 않은 실행 결과는 그대로).
- 서비스 파일(`systemd/`)이나 sudoers를 바꾼 커밋은 자동 반영되지 않는다. `install.sh`를 다시 실행해 적용한다. `update.py` 변경은 성공한 전환 뒤 자동으로 `bin/`에 반영된다.
- 서버가 바뀌는 시험은 공용 ZGX가 아닌 격리 환경에서 한다.
