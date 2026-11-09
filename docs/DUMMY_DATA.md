# 더미 석탄·항차 자료 적재와 회수

공용 항차 원장(ZGX)의 빈 항차 범위와 빈칸을 공개 일반값 기반 더미 자료로 채우고, 필요할 때 걷어내는 절차다.
설계는 `docs/superpowers/specs/2026-11-10-dummy-coal-data-design.md` 3.5~3.6절을 따른다.

- 더미 행은 `data_origin='dummy'`, 실제 행에 채운 칸은 `data_origin='mixed'`와 `dummy_fields`(칸 이름)로 표시된다.
- 실제로 입력된 값은 바꾸지 않는다. 생성기는 비어 있는 칸만 채운다.
- 원장 이력에는 actor `dummy-seed`, origin `dummy-data`로 남는다.
- 사내 자료·계약값·사진에서 옮긴 값은 없다. 성상 범위는 `backend/src/midterm/dummy_data/coal_profiles.json`의 공개 자료 조사에서만 가져온다.

## 명령

```bash
python -m midterm.dummy_data {check|load|unload} [--db PATH] [--seed N] [--yes]
```

| 명령 | 하는 일 | DB 변경 |
| --- | --- | --- |
| `check` | 새로 만들 행 수, 채울 칸 수, 건드리지 않을 실제 값 수, 기준재고 채울 칸 수를 보여 준다. | 없음 (임시 사본에서 계산) |
| `load` | `--yes`가 없으면 `check`와 같은 미리 보기만 보여 준다. | 없음 |
| `load --yes` | 백업 → 원장 한 번 저장(revision +1) → 기준재고 보완본을 새 revision으로 저장(바뀐 것이 없으면 저장 안 함). | 있음 |
| `unload` | `--yes`가 없으면 임시 사본에서 회수를 해 보고 결과만 보여 준다. | 없음 |
| `unload --yes` | 백업 → 실제 행의 더미 칸 비우기(revision +1) → 더미 행 삭제(revision +1) → 기준재고 더미 칸 삭제. 바뀔 것이 없는 단계는 revision을 올리지 않는다. | 있음 |

- `--db` 기본값은 `MIDTERM_PLANNING_DB` 환경변수(없으면 `backend/data/planning-local.sqlite3`)다. 파일이 없으면 새로 만들지 않고 실패한다.
- `--seed` 기본값은 `20261110`이다. 같은 시드와 같은 원장이면 같은 결과가 나온다.
- 출력 첫 줄은 대상 DB 경로다. 실행 전에 경로가 서비스가 쓰는 DB인지 확인한다.
- 마지막 줄은 결과 JSON 한 줄이다. 실패하면 `실패: ...` 줄과 `{"error": ...}` JSON을 출력하고 종료코드 1을 돌려준다.
- `load --yes`를 다시 실행하면 이미 들어간 값과 같다고 판정해 아무것도 바꾸지 않는다.

출력 예시(시험용 고정 자료, 경로는 줄임):

```text
대상 DB: .../planning.sqlite3
[미리 보기] load가 할 일 (DB는 바꾸지 않음)
새로 만들 행: 항차 89 · 화물 90 · 분석 191
실제 행 빈칸 채움: 23행 199칸 (이미 입력된 값 32칸은 그대로)
기준재고 채울 칸: 11
현재 원장 revision 1 · 기준재고 revision 1
실행하려면 --yes를 붙이세요: python -m midterm.dummy_data load --yes
{"db": ".../planning.sqlite3", "create": {"voyages": 89, "cargo": 90, "assays": 191}, ...}
```

## ZGX에서 실행

Claude는 ZGX에 쓰지 않는다. 아래 명령은 사용자가 ZGX 셸에 직접 붙여 넣는다.

1. 서비스가 쓰는 DB 경로만 확인한다. 아래 명령은 서비스 환경변수 가운데 `MIDTERM_PLANNING_DB` 한 줄만 꺼내므로 다른 설정값(키 등)은 화면에 나오지 않는다. 서비스 환경 파일이나 키 파일을 `cat`으로 열지 않는다.

   ```bash
   DB="$(systemctl show -p Environment --value genforecast-backend.service | tr ' ' '\n' | sed -n 's/^MIDTERM_PLANNING_DB=//p')"
   echo "$DB"
   ls -l "$DB"
   if [ -n "$DB" ] && [ -f "$DB" ]; then echo "대상 DB 확인: $DB"; else echo "DB 경로를 확인하세요. 아래 명령을 실행하지 마세요."; fi
   ```

   마지막 줄이 `대상 DB 확인:`이 아니면 2단계로 넘어가지 않는다. 대화형 셸 창이 닫히지 않도록 `exit` 대신 `if` 문으로 확인만 한다.

2. 서비스와 같은 코드·DB로 실행한다. 백엔드 서비스는 계속 켜 둔 채 실행해도 된다(백업은 SQLite 온라인 백업이고, 원장 저장은 revision 충돌을 검사한다).

   ```bash
   cd /home/puyo/genforecast/current/backend
   export PYTHONPATH=/home/puyo/genforecast/current/backend/src
   export MIDTERM_PLANNING_DB="$DB"
   /home/puyo/genforecast/current/.venv/bin/python -m midterm.dummy_data check
   /home/puyo/genforecast/current/.venv/bin/python -m midterm.dummy_data load --yes
   /home/puyo/genforecast/current/.venv/bin/python -m midterm.dummy_data unload --yes
   ```

   `check` 결과와 첫 줄의 대상 DB를 확인한 다음 `load --yes`를 실행한다. `unload --yes`는 더미를 걷어낼 때만 실행한다.

## 백업

- `load --yes`, `unload --yes`는 쓰기 전에 항상 백업한다.
- 위치: `~/.config/genforecast/backups/dummy-YYYYmmdd-HHMMSS/planning.sqlite3`. 시각은 KST다. 같은 초에 두 번 실행하면 폴더 이름 끝에 `-2`, `-3`을 붙인다.
- 환경변수 `GENFORECAST_BACKUP_DIR`가 있으면 `~/.config/genforecast/backups` 대신 그 아래에 만든다.
- 폴더 권한은 가능하면 `0700`(소유자만 읽기·쓰기)으로 만든다. 백업에는 원장 전체가 들어 있으므로 다른 곳에 복사하거나 Git에 넣지 않는다.
- 백업 직후 `PRAGMA quick_check`로 열리는지 확인한다. 실패하면 DB에 쓰지 않고 멈춘다.

## 회수(unload) 규칙

- `data_origin='dummy'` 행(키 접두 `DV-`·`DC-`·`DA-`)은 분석 → 화물 → 항차 순으로 지운다. 지우기 직전 각 키가 여전히 `dummy` 행인지 다시 확인하고, 아니면 아무것도 지우지 않고 멈춘다.
- `data_origin='mixed'` 행은 `dummy_fields`에 적힌 칸만 비우고 `data_origin='entered'`로 돌린다. 사람이 원장 화면이나 엑셀로 고친 칸은 이미 `dummy_fields`에서 빠져 있으므로 남는다.
- 사람이 고친 더미 행(더미 접두 키지만 `mixed`)은 지우지 않고 더미 칸만 비운다.
  - 필수 칸(항차 `status`, 화물 `voyage_no`·`destination_plant_id`·`coal_name`·`bl_t`, 분석 `cargo_no`·`stage`)은 비우지 않는다.
  - 남아 있는 사람 값이 쓰는 기준 칸(`cv`가 남으면 `cv_basis`, 회분·황분 등이 남으면 `analysis_basis`)도 비우지 않는다.
  - 이렇게 남긴 칸은 계속 더미로 표시(`mixed`, `dummy_fields`)하고 결과 JSON `kept_required`에 적는다.
- 더미 행 아래에 지우지 않는 하위 행(사람이 고친 더미 화물 등)이 남으면 그 상위 더미 행도 지우지 않고 `kept_parents`에 적는다. 하위 행 때문에 삭제가 실패하지 않는다.
- 기준재고: 최신 판의 각 적치 파일에서 `dummy_fields`에 적힌 칸 가운데 **값이 적재기(`dummy-seed`)가 마지막으로 쓴 값과 같은 칸만** 더미 적재 전 값(같은 기준일의 이전 판)으로 되돌리고 `dummy_fields`를 지운 새 판을 저장한다. 값이 다른 칸은 사람이 고친 값이므로 남기고 결과 JSON `kept_baseline`에 적는다. 바뀐 것이 없으면 저장하지 않는다.
  - 적치 파일은 `(source_id, location, coal_name, voyage_number)`로 판끼리 대응시킨다. 한 판 안에서 이 키가 겹치면 대응할 수 없으므로 아무것도 쓰지 않고 멈춘다(원장도 바꾸지 않음).
- 기준재고 저장 규칙(`save_baseline`, 적재기 외 저장): 같은 기준일의 직전 판(없으면 가장 최신 판)과 비교해, 더미 표시된 칸 중 값이 바뀐 칸은 `dummy_fields`에서 뺀다. 직전 판에 없던 더미 표시를 사람이 추가해 보내면 무시한다. 키가 겹쳐 대응할 수 없는 적치는 더미 표시를 지운다(사람이 고친 값이 지워지는 것보다 더미 표시를 잃는 쪽이 안전).
- 회수한 행·칸은 원장 이력(`voyage_registry_audit`, origin `dummy-data`)에 남는다.

## 백업에서 되돌리기(마지막 수단)

`unload --yes`로 해결되지 않을 때만 쓴다. 백업 이후의 모든 원장·재고 변경도 함께 사라진다.

먼저 "ZGX에서 실행"의 1단계를 다시 실행해 `$DB`가 서비스 DB 경로인지 확인한다. 같은 확인 줄이 `대상 DB 확인:`을 출력할 때만 아래를 실행한다.

```bash
if [ -n "$DB" ] && [ -f "$DB" ]; then echo "대상 DB 확인: $DB"; else echo "DB 경로를 확인하세요. 아래 명령을 실행하지 마세요."; fi
# 위 줄이 "대상 DB 확인:"을 출력했을 때만 이어서 실행한다.
sudo systemctl stop genforecast-backend.service
/home/puyo/genforecast/current/.venv/bin/python -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" \
  ~/.config/genforecast/backups/dummy-YYYYmmdd-HHMMSS/planning.sqlite3 "$DB"
sudo systemctl start genforecast-backend.service
```

파일 복사(`cp`) 대신 SQLite 백업 API를 쓴다. WAL 파일이 남아 있어도 일관된 상태로 덮어쓴다.

## 탄종별 성상 출처 수준

`backend/src/midterm/dummy_data/coal_profiles.json`에서 옮긴 표다. 근거 수준 "근거있음"은 같은 원산지·등급의 공개 규격이 있는 경우, "추정"은 같은 원산지 일반값으로 정한 경우다. 출처 주소는 JSON의 `sources`에 있다.

| 탄종 | 원산지 | 등급 | 열량 구분(class) | 근거 수준(confidence) |
| --- | --- | --- | --- | --- |
| AVRA | 인도네시아 칼리만탄 저품위 아역청탄(추정, ABM 계열 탄 판매사) | Indonesian 4200 GAR급(추정) | low_cv | 추정 |
| MERCURIA | 인도네시아 중저열량 아역청탄(추정, 트레이더 공급) | Indonesian 4600 GAR급(추정) | low_cv | 추정 |
| Flame | 남아프리카공화국 역청탄(논문 표기 'Flame(SA)') | 6200 GAR급 역청탄 | high_cv | 추정 |
| Glencore | 호주 뉴캐슬 일반탄(NEWC) | NEWC 6000 NAR급 (GAR 약 6300) | high_cv | 근거있음 |
| Glencore(무연탄) | 무연탄(러시아/베트남계 추정) | 무연탄(Anthracite) 6400~6500 GAR급(추정) | high_cv | 추정 |
| Centennial | 호주 NSW (Mandalong/Angus Place 등) | NSW 저유황 일반탄 6200 GAR급(추정) | high_cv | 추정 |
| KCH(Kaltim) | 인도네시아 Kaltim Prima Coal (Pinang 6200 GAR급 가정) | Pinang 6200 GAR급 | high_cv | 근거있음 |
| KCH(adaro) | 인도네시아 Adaro Envirocoal | Envirocoal E5000 GAR | low_cv | 근거있음 |
| KCH(Arutmin) | 인도네시아 칼리만탄 Arutmin 아역청탄 | Arutmin 5000 GAR급(가정) | low_cv | 추정 |
| LXI | 인도네시아 저칼로리탄(추정, LX International 자원개발 연계) | Indonesian 4200 GAR급(GAM 광산 범위) | low_cv | 추정 |

열량 구분 경계: `high_cv` GAR 5,700~6,500 kcal/kg·황분(AR) 0.8% 이하, `low_cv` GAR 3,700~5,349 kcal/kg·황분(AR) 1.0% 이하(공개 논문·입찰 공고 기준, JSON `classes.*.source`).
