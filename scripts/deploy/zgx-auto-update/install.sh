#!/usr/bin/env bash
# GenForecast ZGX 자동 갱신 최초 설치. ZGX에서 사용자 puyo가 한 번 실행한다(여러 번 실행해도 안전).
#
#   bash /home/puyo/genforecast/repo/scripts/deploy/zgx-auto-update/install.sh
#
# 하지 않는 일: DB 내용 변경, backend.env 읽기, Tailscale의 /, /api, /preview 경로 변경,
#               기존 2026-10-12 설치 폴더나 다른 사람 폴더의 내용 변경.
set -euo pipefail

BASE=/home/puyo/genforecast
REPO="$BASE/repo"
BIN="$BASE/bin"
REPO_URL=https://github.com/runtosurvive0/genForecast.git
CONDA_ROOT=/home/puyo/miniforge3
PY="$CONDA_ROOT/envs/genforecast/bin/python"
NODE_ENV=genforecast-node
NODE_BIN="$CONDA_ROOT/envs/$NODE_ENV/bin"
OLD_BACKEND=/home/puyo/genforecast-hp-20261012/backend
SHARED_DATA="$OLD_BACKEND/data"
CONFIG=/home/puyo/.config/genforecast
BACKUPS="$CONFIG/backups"
DEMO_ENV="$CONFIG/demo.env"
PUBLIC_URL=https://zgx-6660.tailec6d33.ts.net
SYSTEMD=/etc/systemd/system
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS="$HERE/systemd"
DEMO_PATH=/demo-stream
DEMO_TARGET=http://127.0.0.1:61578/demo-stream

step() { printf '\n[%s/8] %s\n' "$1" "$2"; }
info() { printf '  - %s\n' "$*"; }
die() { printf '\n[중단] %s\n' "$*" >&2; exit 1; }
trap 'printf "\n[중단] %s행에서 실패했습니다. 위 메시지를 확인하세요. 서버는 마지막으로 성공한 단계 상태입니다.\n" "$LINENO" >&2' ERR

# 파일이 이미 같으면 건너뛰고, 다르면 root 소유로 설치한다.
install_root_file() { # 원본 대상 권한
  if sudo test -f "$2" && sudo cmp -s "$1" "$2"; then
    info "이미 같음: $2"
  else
    sudo install -D -o root -g root -m "$3" "$1" "$2"
    info "설치: $2"
  fi
}

serve_json() { sudo tailscale serve status --json 2>/dev/null || echo '{}'; }

# 갱신기를 실행한다. 76(GitHub 검사 대기)·75(다른 갱신 진행 중)이면 1분 간격으로 최대 30번 다시 실행한다.
# 결과 종료 코드를 UPDATER_RC에 남긴다.
run_updater() {
  local attempt
  for attempt in $(seq 1 30); do
    UPDATER_RC=0
    "$PY" "$BIN/update.py" "$@" || UPDATER_RC=$?
    case "$UPDATER_RC" in
      76) info "GitHub 검사(verify, backend)가 끝나기를 기다립니다($attempt/30, 1분 뒤 다시 확인)." ;;
      75) info "다른 갱신이 진행 중입니다($attempt/30, 1분 뒤 다시 시도)." ;;
      *) return 0 ;;
    esac
    sleep 60
  done
}

# serve 설정에 필요한 경로와 Funnel이 모두 있는지 확인한다. 인자: 반드시 있어야 할 경로들.
check_serve() {
  serve_json | "$PY" -c '
import json, sys
need = sys.argv[1:]
config = json.load(sys.stdin) or {}
paths = {path for web in (config.get("Web") or {}).values() for path in (web.get("Handlers") or {})}
funnel = any((config.get("AllowFunnel") or {}).values())
missing = [p for p in need if p not in paths]
print("  - 경로:", ", ".join(sorted(paths)) or "없음", "/ Funnel:", "켜짐" if funnel else "꺼짐")
sys.exit(0 if funnel and not missing else 1)
' "$@"
}

printf 'GenForecast ZGX 자동 갱신 설치를 시작합니다.\n'
[ "$(id -u)" -ne 0 ] || die "root가 아니라 puyo 계정으로 실행하세요(필요한 곳만 sudo를 씁니다)."
[ "$(id -un)" = puyo ] || die "puyo 계정에서 실행하세요."
for tool in git sudo tailscale; do command -v "$tool" >/dev/null || die "$tool 명령이 없습니다."; done
[ -x /usr/bin/systemctl ] || die "/usr/bin/systemctl이 없습니다(sudoers 규칙이 이 경로를 씁니다)."
[ -x "$PY" ] || die "Python 환경이 없습니다: $PY"
"$PY" -c 'import venv, ensurepip' 2>/dev/null || die "$PY에 venv/ensurepip 모듈이 없습니다(릴리스 전용 venv에 필요)."
[ -d "$SHARED_DATA" ] || die "공유 데이터 폴더가 없습니다: $SHARED_DATA"
[ -f "$HERE/update.py" ] || die "update.py를 찾지 못했습니다: $HERE"
info "sudo 암호를 한 번 물을 수 있습니다."
sudo -v

# 설치하는 동안 자동 갱신 타이머를 멈춘다. 중간에 멈추면 원래 켜져 있던 타이머만 다시 켠다.
TIMER_WAS_ACTIVE=0
INSTALL_DONE=0
if systemctl is-active --quiet genforecast-update.timer 2>/dev/null; then
  TIMER_WAS_ACTIVE=1
  sudo systemctl stop genforecast-update.timer
  info "설치 동안 자동 갱신 타이머를 멈췄습니다."
fi
restore_timer() {
  if [ "$INSTALL_DONE" = 0 ] && [ "$TIMER_WAS_ACTIVE" = 1 ]; then
    sudo systemctl start genforecast-update.timer >/dev/null 2>&1 || true
    printf '  - 자동 갱신 타이머를 원래대로 다시 켰습니다.\n' >&2
  fi
}
trap restore_timer EXIT
for _ in $(seq 1 120); do
  systemctl is-active --quiet genforecast-update.service 2>/dev/null || break
  info "진행 중인 자동 갱신이 끝나기를 기다립니다."
  sleep 15
done

step 1 "Node 환경($NODE_ENV, Node 22.13 이상) 준비"
node_ok() {
  [ -x "$NODE_BIN/node" ] && "$NODE_BIN/node" -e '
const [a, b] = process.versions.node.split(".").map(Number);
process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
}
if node_ok; then
  info "이미 있음: $("$NODE_BIN/node" --version)"
else
  CONDA="$CONDA_ROOT/bin/conda"
  [ -x "$CONDA_ROOT/bin/mamba" ] && CONDA="$CONDA_ROOT/bin/mamba"
  [ -x "$CONDA" ] || die "conda가 없습니다: $CONDA_ROOT/bin/conda"
  if [ -d "$CONDA_ROOT/envs/$NODE_ENV" ]; then
    "$CONDA" install -y -n "$NODE_ENV" -c conda-forge 'nodejs>=22.13'
  else
    "$CONDA" create -y -n "$NODE_ENV" -c conda-forge 'nodejs>=22.13'
  fi
  node_ok || die "Node 22.13 이상을 준비하지 못했습니다."
  info "설치됨: $("$NODE_BIN/node" --version)"
fi

step 2 "작업 폴더와 저장소 준비($REPO)"
mkdir -p "$BASE" "$BASE/releases" "$BASE/state" "$BASE/data" "$BASE/shared" "$BIN"
chmod 0750 "$BASE/state"
if [ -d "$REPO/.git" ]; then
  origin="$(git -C "$REPO" remote get-url origin)"
  case "$origin" in
    "$REPO_URL"|https://github.com/runtosurvive0/genForecast|git@github.com:runtosurvive0/genForecast.git) ;;
    *) die "$REPO의 origin이 GenForecast 저장소가 아닙니다." ;;
  esac
  git -C "$REPO" fetch --prune origin '+refs/heads/main:refs/remotes/origin/main'
  info "이미 있음: 최신 main을 받았습니다."
elif [ -e "$REPO" ]; then
  die "$REPO가 git 저장소가 아닌데 이미 있습니다. 내용을 확인하세요."
else
  git clone "$REPO_URL" "$REPO"
  info "복제 완료"
fi

step 3 "갱신기 설치($BIN/update.py)"
if cmp -s "$HERE/update.py" "$BIN/update.py"; then
  info "이미 같음"
else
  install -m 0755 "$HERE/update.py" "$BIN/update.py"
  info "복사 완료"
fi

step 4 "첫 릴리스 시험·빌드(전환하지 않음, 수십 분 걸릴 수 있음)"
run_updater deploy --no-switch --retry
case "$UPDATER_RC" in
  0) ;;
  75|76) die "GitHub 검사 대기 또는 다른 갱신 때문에 30분 안에 준비하지 못했습니다. 서버는 바뀌지 않았습니다. 잠시 뒤 다시 실행하세요." ;;
  *) die "시험·빌드가 실패했습니다. 서버는 바뀌지 않았습니다. 'update.py status'와 위 로그를 확인한 뒤 다시 실행하세요." ;;
esac

step 5 "sudo 권한(재시작만)과 서비스 파일 설치"
sudo visudo -cf "$UNITS/sudoers-genforecast" >/dev/null || die "sudoers 문법 검사 실패"
install_root_file "$UNITS/sudoers-genforecast" /etc/sudoers.d/genforecast 0440
sudo visudo -c >/dev/null || die "전체 sudoers 검사 실패"
for unit in genforecast-update.service genforecast-update.timer genforecast-demo.service; do
  install_root_file "$UNITS/$unit" "$SYSTEMD/$unit" 0644
done
sudo systemctl daemon-reload
sudo systemctl enable genforecast-demo.service >/dev/null
info "genforecast-demo 서비스 활성화(시작은 7단계 전환 때)"
# 데모 조작반 토큰: 한 번만 만들고 이미 있으면 유지한다. 값은 출력하지 않는다.
if [ -f "$DEMO_ENV" ]; then
  info "조작반 토큰 파일이 이미 있음: $DEMO_ENV"
else
  mkdir -p "$CONFIG"
  ( umask 077
    token="$("$PY" -c 'import secrets; print(secrets.token_urlsafe(32))')"
    printf 'DEMO_CONTROLLER_TOKEN=%s\n' "$token" > "$DEMO_ENV" )
  info "조작반 토큰을 만들었습니다(값은 출력하지 않음): $DEMO_ENV"
fi
chmod 0600 "$DEMO_ENV"

step 6 "Tailscale에 $DEMO_PATH 경로 추가(/, /api, /preview와 Funnel 유지)"
mkdir -p "$BACKUPS"
serve_before="$(serve_json)"
case "$serve_before" in *"\"$DEMO_PATH\""*) has_demo=1 ;; *) has_demo=0 ;; esac
# /preview는 다른 사람 경로다. 변경 전에 있었을 때만 그대로 남았는지 확인한다.
need_paths=(/ /api "$DEMO_PATH")
case "$serve_before" in *'"/preview"'*) need_paths+=(/preview) ;; esac
if [ "$has_demo" = 1 ]; then
  info "이미 있음"
else
  before="$BACKUPS/tailscale-serve-before-autodeploy.json"
  [ -f "$before" ] || { serve_json > "$before"; chmod 0600 "$before"; info "변경 전 설정 저장: $before"; }
  # Funnel이 켜진 443 포트에 경로 하나만 더한다. 기존 경로는 그대로 남는다.
  # 대상 주소 끝의 /demo-stream은 Tailscale이 마운트 경로를 떼고 전달하기 때문에 필요하다(/api와 같은 방식).
  sudo tailscale funnel --bg --set-path "$DEMO_PATH" "$DEMO_TARGET"
fi
if ! check_serve "${need_paths[@]}"; then
  die "Tailscale 경로 확인 실패. 'sudo tailscale serve status'로 확인하세요. 변경 전 설정: $BACKUPS/tailscale-serve-before-autodeploy.json"
fi

step 7 "현재 릴리스로 전환하고 상태 확인"
# 옛 설치가 실행 중에 만든 runs/·inputs/를 공유 폴더로 복사한다(이미 있는 파일은 덮어쓰지 않음, 옛 폴더는 읽기만).
"$PY" "$BIN/update.py" seed-shared "$OLD_BACKEND" || die "runs/·inputs/ 복사 실패. 서버는 바뀌지 않았습니다."
install_root_file "$UNITS/backend-current.conf" "$SYSTEMD/genforecast-backend.service.d/backend-current.conf" 0644
install_root_file "$UNITS/frontend-current.conf" "$SYSTEMD/genforecast-frontend.service.d/frontend-current.conf" 0644
sudo systemctl daemon-reload

restore_old_install() {
  printf '\n  기존 설치(2026-10-12)로 서비스를 되돌립니다.\n'
  sudo rm -f "$SYSTEMD/genforecast-backend.service.d/backend-current.conf" \
             "$SYSTEMD/genforecast-frontend.service.d/frontend-current.conf"
  sudo systemctl daemon-reload
  sudo systemctl disable --now genforecast-demo.service >/dev/null 2>&1 || true
  sudo systemctl restart genforecast-backend.service genforecast-frontend.service
}

wd="$(systemctl show -p WorkingDirectory --value genforecast-backend.service)"
if [ "$wd" != "$BASE/current/backend" ]; then
  restore_old_install
  die "백엔드 drop-in이 적용되지 않았습니다(WorkingDirectory=$wd). 다른 drop-in이 덮어쓰는지 확인하세요."
fi
for svc in genforecast-backend.service genforecast-frontend.service; do
  exec_start="$(systemctl show -p ExecStart --value "$svc")"
  case "$exec_start" in
    *"$BASE/current/.venv/bin/python"*) ;;
    *) restore_old_install
       die "$svc의 ExecStart가 릴리스 venv로 바뀌지 않았습니다. 다른 drop-in이 덮어쓰는지 확인하세요." ;;
  esac
done
# 같은 변수가 여러 번 있으면 마지막 값이 적용된다. 마지막 GENFORECAST_FRONTEND_FILE이 현재 릴리스 화면인지 본다.
frontend_file=""
for item in $(systemctl show -p Environment --value genforecast-frontend.service); do
  case "$item" in GENFORECAST_FRONTEND_FILE=*) frontend_file="${item#GENFORECAST_FRONTEND_FILE=}" ;; esac
done
if [ "$frontend_file" != "$BASE/current/dist/index.html" ]; then
  restore_old_install
  die "화면 drop-in의 GENFORECAST_FRONTEND_FILE이 적용되지 않았습니다(현재 값: ${frontend_file:-없음})."
fi
run_updater deploy
if [ "$UPDATER_RC" = 0 ] && [ -L "$BASE/current" ]; then
  info "전환·상태 확인 통과"
elif [ -L "$BASE/current" ]; then
  die "새 커밋 반영이 실패해 갱신기가 이전 릴리스를 유지했습니다(종료 코드 $UPDATER_RC). 'update.py status'로 확인한 뒤 다시 실행하세요."
else
  restore_old_install
  die "첫 전환이 실패해(종료 코드 $UPDATER_RC) 기존 설치로 복구했습니다. 위 로그를 확인하세요."
fi
[ -L "$BASE/current" ] || { restore_old_install; die "current 링크가 없습니다. 기존 설치로 복구했습니다."; }

step 8 "자동 갱신 타이머 켜기(5분마다)"
sudo systemctl enable --now genforecast-update.timer >/dev/null
INSTALL_DONE=1
systemctl list-timers genforecast-update.timer --no-pager || true
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: Z2VuZm9yZWNhc3QtY2hlY2s=' -H 'Origin: https://zgx-6660.tailec6d33.ts.net' \
  "https://zgx-6660.tailec6d33.ts.net$DEMO_PATH?role=viewer" 2>/dev/null || true)"
info "공개 주소 $DEMO_PATH 연결 시험: HTTP ${code:-응답 없음} (101이면 정상)"

trap - ERR
printf '\n설치 완료. main에 병합된 커밋은 5분마다 확인하고, GitHub 검사가 통과하면 시험·빌드를 거쳐 반영합니다.\n'
printf '데모 조작반 주소: %s/#demo-control?token=<토큰>\n' "$PUBLIC_URL"
printf '  <토큰> 자리에는 %s 파일의 DEMO_CONTROLLER_TOKEN 값을 넣습니다(이 화면에는 출력하지 않음).\n' "$DEMO_ENV"
printf '상태: systemctl status genforecast-update.timer / 기록: journalctl -u genforecast-update -n 50\n'
