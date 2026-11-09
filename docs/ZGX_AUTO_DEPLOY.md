# ZGX 자동 갱신

공용 서버 ZGX(https://zgx-6660.tailec6d33.ts.net)는 GitHub `main`의 최신 커밋을 약 5분마다 확인한다. 새 커밋은 시험과 빌드를 통과했을 때만 반영하고, 반영 뒤 서비스가 정상 응답하지 않으면 이전 버전으로 되돌린다.

파일: `scripts/deploy/zgx-auto-update/`

| 파일 | 역할 |
| --- | --- |
| `update.py` | 갱신기(표준 라이브러리만). `deploy`, `status`, `rollback`, `check` |
| `install.sh` / `uninstall.sh` | 최초 설치 / 해제(기존 2026-10-12 설치로 복귀) |
| `systemd/genforecast-update.service`, `.timer` | 5분마다 `update.py deploy` 실행 |
| `systemd/genforecast-demo.service` | `/demo-stream` 웹소켓 서버(`scripts/fuel-demo/server.cjs`) |
| `systemd/backend-current.conf`, `frontend-current.conf` | 기존 백엔드·화면 서비스가 현재 릴리스에서 실행되게 하는 drop-in |
| `systemd/sudoers-genforecast` | 세 서비스 재시작만 암호 없이 허용 |

## 동작 원리

ZGX의 폴더 구성:

```text
/home/puyo/genforecast/
  repo/       GitHub 저장소 clone(fetch와 git archive에만 사용)
  releases/   커밋별 릴리스(최근 3개 보관). 각 릴리스에 전용 .venv가 있다
  current ->  지금 서비스 중인 릴리스(심볼릭 링크)
  bin/        설치된 갱신기 update.py
  state/      실패 커밋, 이전 릴리스, 잠금 파일
  shared/     runs/, inputs/ (서버가 실행 중에 만드는 계획 실행·시나리오. 릴리스 사이에 보존)
  data/       데모 모의 운전 상태 DB(operating-simulation.sqlite3)
/home/puyo/genforecast-hp-20261012/backend/data/   실사용 DB·공유 자료(그대로 사용)
```

백엔드·화면 서비스는 drop-in으로 `ExecStart`를 비운 뒤 `/home/puyo/genforecast/current/.venv/bin/python`으로 다시 정의한다. 공용 Python 환경(`genforecast`)에는 아무것도 설치하지 않는다.

`update.py deploy` 순서:

1. 잠금을 잡는다. 이미 실행 중이면 조용히 끝낸다.
2. `origin/main`을 받는다. 현재 커밋과 같거나, 이전에 실패한 커밋이면 끝낸다.
3. `git archive`로 `releases/<UTC시각>-<짧은커밋>`에 풀고 `REVISION`에 커밋을 적는다.
4. 릴리스 전용 환경 `PY -m venv --system-site-packages <릴리스>/.venv`를 만들고 `backend/pyproject.toml`의 의존성(+dev)을 거기에 `pip install`한다. 공용 환경에 이미 맞는 패키지(numpy, fastapi 등)는 그대로 재사용되고, 없는 것(예: highspy)만 이 릴리스에 설치된다.
5. 시험: 백엔드 `pytest`는 릴리스 venv의 Python으로, 공유 DB·runs·inputs가 연결되지 않은 별도 임시 사본에서, 키·DB 경로 변수를 모두 뺀 환경으로 실행한다. 화면은 `npm ci`, `npm test`, `npm run build` 후 `dist/index.html`을 확인한다.
6. 공유 데이터 연결: 기존 데이터 폴더의 파일 중 그 커밋에 추적되지 않은 것(DB, `-wal`/`-shm`, `coal_units.csv` 등)만 릴리스 `backend/data/`에 링크한다. 추적되는 파일(시드 `planning.sqlite3`, `*.csv.json`)은 저장소 사본을 쓴다.
   runs/·inputs/: 그 커밋에 추적된 파일은 `shared/runs`, `shared/inputs`에 덮어써 맞추고, 추적되지 않은 파일(서버가 만든 실행, `last_scenario.json` 등)은 그대로 둔다. 그다음 릴리스의 `backend/runs`, `backend/inputs`를 공유 폴더 링크로 바꾼다.
7. 전환 전에 공유 데이터의 `*.sqlite3`를 SQLite backup API로 `~/.config/genforecast/backups/auto-<시각>/`에 복사한다(자동 백업 최근 3개만 보관, 수동 백업은 건드리지 않음).
8. `current` 링크를 새 릴리스로 원자적으로 바꾸고 세 서비스를 재시작한다.
9. 최대 60초 동안 상태를 확인한다: 백엔드 8093(500 미만, 로그인 필요 401도 정상), 화면 8094 `/` 200, 데모 61578 `/health` 200.
10. 실패하면 `current`를 이전 릴리스로 되돌리고 재시작한 뒤, 그 커밋을 실패로 기록한다. 시험·빌드가 실패하면 전환 자체를 하지 않는다.
11. 성공하면 오래된 릴리스를 정리한다(3개 보관). 현재와 직전 릴리스를 뺀 나머지 릴리스의 `node_modules`는 지운다. 새 커밋의 `update.py`가 설치본과 다르면 `bin/update.py`를 교체한다(다음 실행부터 적용).

실패 분류:

- **실패 커밋으로 기록**(같은 커밋은 다시 시도하지 않음): 백엔드 시험, `npm test`, `npm run build`, 전환 뒤 상태 확인 실패, 수동 `rollback`.
- **다음 주기(5분 뒤)에 다시 시도**: `git fetch`/`git archive`, venv 생성, `pip install`, `npm ci`, 공유 데이터 연결, 디스크 등 파일 작업 오류, 전환 전 백업 실패.

실패로 기록된 커밋은 고친 커밋이 `main`에 병합되면 그 커밋으로 넘어간다. 같은 커밋을 다시 시도하려면 `--retry`를 쓴다.

## 최초 설치

PR이 `main`에 병합된 뒤, ZGX 터미널(NVIDIA Sync)에서 `puyo` 계정으로 붙여 넣는다. 처음 한 번 sudo 암호를 물을 수 있다. 시험·빌드 때문에 수십 분 걸릴 수 있다.

```bash
test -d /home/puyo/genforecast/repo/.git || git clone https://github.com/runtosurvive0/genForecast.git /home/puyo/genforecast/repo
git -C /home/puyo/genforecast/repo pull --ff-only origin main
bash /home/puyo/genforecast/repo/scripts/deploy/zgx-auto-update/install.sh
```

`install.sh` 단계(이미 된 단계는 건너뛰므로 다시 실행해도 안전):

1. conda로 Node 환경 `genforecast-node`(conda-forge `nodejs>=22.13`) 준비
2. `/home/puyo/genforecast`와 저장소 clone
3. `update.py`를 `bin/`에 복사
4. 첫 릴리스 시험·빌드만(`update.py deploy --no-switch --retry`). 실패하면 여기서 멈추고 서버는 그대로다.
5. sudoers(`visudo -cf` 검사 후 0440), 서비스 파일 설치, `daemon-reload`, `genforecast-demo` 활성화
6. Tailscale에 `/demo-stream` 경로 추가(아래). 변경 전 설정을 `~/.config/genforecast/backups/tailscale-serve-before-autodeploy.json`에 저장한다.
7. 옛 설치의 `backend/runs`, `backend/inputs`를 `shared/`로 복사한다(`update.py seed-shared`, 이미 있는 파일은 덮어쓰지 않고 옛 폴더는 읽기만 함). drop-in을 설치하고 `WorkingDirectory`와 `ExecStart`가 바뀌었는지 확인한 뒤 `update.py deploy`로 전환·재시작·상태 확인을 한다. 첫 전환이 실패하면 drop-in을 지우고 기존 설치(2026-10-12 폴더)로 서비스를 복구한다.
8. `genforecast-update.timer` 켜기

### Tailscale 경로 (ZGX Tailscale 1.104.2 기준)

기존 `/`, `/api`, `/preview` 경로와 Funnel은 그대로 두고 경로 하나만 더한다.

```bash
# 추가(install.sh 6단계)
sudo tailscale funnel --bg --set-path /demo-stream http://127.0.0.1:61578/demo-stream
# 확인
sudo tailscale serve status
# 제거(uninstall.sh 5단계)
sudo tailscale serve --set-path /demo-stream off
```

- Tailscale은 마운트 경로(`/demo-stream`)를 떼고 전달하므로 대상 주소에도 `/demo-stream`을 붙인다. 기존 `/api` → `127.0.0.1:8093/api`와 같은 방식이다.
- 443 포트에 Funnel이 켜져 있으므로 반드시 `tailscale funnel` 하위 명령으로 추가한다. 1.104.2 소스(`cmd/tailscale/cli/serve_v2.go`의 `applyFunnel`)에서는 Funnel이 켜진 포트에 `tailscale serve`로 핸들러를 더하면 그 포트의 Funnel이 꺼진다("Removing Funnel" 출력). `--set-path`는 해당 경로 하나만 더한다.
- 제거(`serve --set-path … off`)는 그 경로 하나만 지운다. 같은 포트에 다른 경로가 남아 있으면 Funnel은 그대로다.
- 설치 스크립트는 추가 뒤 `/`, `/api`, `/preview`, `/demo-stream`과 Funnel이 모두 있는지 확인하고, 아니면 멈춘다. Tailscale을 크게 올린 뒤 다시 설치한다면 `tailscale funnel --help`로 `--bg`, `--set-path`가 있는지 먼저 확인한다.

## 상태 보기

```bash
systemctl status genforecast-update.timer
journalctl -u genforecast-update -n 50
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py status
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py check
```

## 수동 실행

```bash
sudo systemctl start genforecast-update.service      # 타이머를 기다리지 않고 한 번 실행
/home/puyo/miniforge3/envs/genforecast/bin/python /home/puyo/genforecast/bin/update.py deploy --retry   # 실패 기록 커밋 재시도
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

`uninstall.sh`는 `shared/runs`, `shared/inputs`를 지우지 않고, 옛 설치로 자동 복사하지도 않는다. 자동 갱신 기간에 새로 생긴 실행 결과·시나리오를 옛 설치에서도 보려면, 해제한 뒤 내용을 확인하고 덮어쓰지 않는 복사로 직접 옮긴다.

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

- `main`에 병합하면 약 5분 안에(시험·빌드 시간 별도) 공용 서버에 반영된다. 병합 전에 PR 리뷰와 CI를 반드시 거친다.
- 전환 전 데이터 백업: `~/.config/genforecast/backups/auto-<시각>/`(최근 3개).
- DB 스키마 변경은 되돌리지 않는다. 코드를 되돌려도 새 코드가 바꾼 DB 구조·내용은 그대로 남으므로, 스키마를 바꾸는 PR은 이전 코드와 호환되게 만들고 필요하면 백업으로 직접 복구한다.
- 키는 `/home/puyo/.config/genforecast/backend.env`에만 둔다. 갱신기는 이 파일을 읽지 않고, 시험은 키 없이 실행한다.
- 의존성은 릴리스별 `.venv`에만 설치한다. 공용 환경 `genforecast`는 바뀌지 않지만, `--system-site-packages`로 그 패키지를 함께 쓰므로 공용 환경을 직접 바꾸면 모든 릴리스에 영향을 준다.
- `shared/runs`, `shared/inputs`는 자동 백업 대상이 아니다. 추적 파일은 새 커밋이 전환 전에 덮어쓴다. 전환이 실패해 되돌려도 그 파일은 새 커밋 내용으로 남는다(추적되지 않은 실행 결과는 그대로).
- 서비스 파일(`systemd/`)이나 sudoers를 바꾼 커밋은 자동 반영되지 않는다. `install.sh`를 다시 실행해 적용한다. `update.py` 변경은 성공한 전환 뒤 자동으로 `bin/`에 반영된다.
- 서버가 바뀌는 시험은 공용 ZGX가 아닌 격리 환경에서 한다.
