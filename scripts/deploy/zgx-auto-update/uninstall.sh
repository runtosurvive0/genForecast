#!/usr/bin/env bash
# GenForecast ZGX 자동 갱신 해제: 서비스를 기존 설치(2026-10-12 폴더)로 되돌린다. 여러 번 실행해도 안전하다.
#
#   bash /home/puyo/genforecast/repo/scripts/deploy/zgx-auto-update/uninstall.sh
#
# 데이터(DB·CSV·백업), backend.env, /home/puyo/genforecast 폴더, Tailscale의 /, /api, /preview는 건드리지 않는다.
set -euo pipefail

SYSTEMD=/etc/systemd/system
DEMO_PATH=/demo-stream
PY=/home/puyo/miniforge3/envs/genforecast/bin/python

step() { printf '\n[%s/6] %s\n' "$1" "$2"; }
info() { printf '  - %s\n' "$*"; }
die() { printf '\n[중단] %s\n' "$*" >&2; exit 1; }
trap 'printf "\n[중단] %s행에서 실패했습니다. 다시 실행해도 안전합니다.\n" "$LINENO" >&2' ERR

remove_root_file() {
  if sudo test -e "$1"; then sudo rm -f "$1"; info "삭제: $1"; else info "이미 없음: $1"; fi
}

printf 'GenForecast ZGX 자동 갱신을 해제합니다.\n'
[ "$(id -u)" -ne 0 ] || die "root가 아니라 puyo 계정으로 실행하세요."
sudo -v

step 1 "자동 갱신 타이머 끄기"
sudo systemctl disable --now genforecast-update.timer >/dev/null 2>&1 || true
sudo systemctl stop genforecast-update.service >/dev/null 2>&1 || true
info "타이머와 진행 중인 갱신을 멈췄습니다."

step 2 "기존 서비스의 drop-in 제거 후 기존 설치로 재시작"
remove_root_file "$SYSTEMD/genforecast-backend.service.d/backend-current.conf"
remove_root_file "$SYSTEMD/genforecast-frontend.service.d/frontend-current.conf"
sudo systemctl daemon-reload
sudo systemctl restart genforecast-backend.service genforecast-frontend.service
info "WorkingDirectory: $(systemctl show -p WorkingDirectory --value genforecast-backend.service)"

step 3 "데모 서비스와 갱신 서비스 파일 제거"
sudo systemctl disable --now genforecast-demo.service >/dev/null 2>&1 || true
for unit in genforecast-demo.service genforecast-update.service genforecast-update.timer; do
  remove_root_file "$SYSTEMD/$unit"
done
sudo systemctl daemon-reload

step 4 "sudo 재시작 권한 제거"
remove_root_file /etc/sudoers.d/genforecast

step 5 "Tailscale에서 $DEMO_PATH 경로만 제거"
case "$(sudo tailscale serve status --json 2>/dev/null || true)" in *"\"$DEMO_PATH\""*) has_demo=1 ;; *) has_demo=0 ;; esac
if [ "$has_demo" = 1 ]; then
  sudo tailscale serve --set-path "$DEMO_PATH" off
  info "제거했습니다."
else
  info "이미 없음"
fi
sudo tailscale serve status --json 2>/dev/null | "$PY" -c '
import json, sys
config = json.load(sys.stdin) or {}
paths = {p for web in (config.get("Web") or {}).values() for p in (web.get("Handlers") or {})}
funnel = any((config.get("AllowFunnel") or {}).values())
print("  - 남은 경로:", ", ".join(sorted(paths)) or "없음", "/ Funnel:", "켜짐" if funnel else "꺼짐")
' || true

step 6 "상태 확인"
ok=1
for i in $(seq 1 20); do
  b="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8093/api/meta || true)"
  f="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8094/ || true)"
  if [ "${b:-000}" != 000 ] && [ "${b:-000}" -lt 500 ] && [ "$f" = 200 ]; then ok=0; break; fi
  sleep 3
done
[ "$ok" -eq 0 ] || die "기존 설치 상태 확인 실패(백엔드 ${b:-?}, 화면 ${f:-?}). journalctl -u genforecast-backend -n 50 으로 확인하세요."
info "백엔드 HTTP $b, 화면 HTTP $f"

trap - ERR
printf '\n해제 완료. 데이터와 /home/puyo/genforecast(저장소·릴리스·상태·shared/runs·shared/inputs), 백업은 남겨 두었습니다.\n'
printf '자동 갱신 중 새로 생긴 실행 결과는 /home/puyo/genforecast/shared/runs에 있습니다. 옛 설치로 옮기는 방법은 docs/ZGX_AUTO_DEPLOY.md를 보세요.\n'
