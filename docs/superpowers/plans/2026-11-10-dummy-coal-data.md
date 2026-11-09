# 0단계 더미 석탄·항차·부두 자료 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development(추천) 또는 superpowers:executing-plans로 과제별로 실행한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** ZGX 원장의 빈칸을 결정적(같은 시드면 같은 값) 더미 자료로 채우고, 더미임을 칸 단위로 기록하며, 사람이 직접 실행·되돌릴 수 있는 생성기·적재기를 만든다.

**구조:** 원장 계약에 `data_origin`·`dummy_fields`·체선 칸·`fe2o3`를 더한다. `backend/src/midterm/dummy_data/` 패키지가 성상 표(JSON) → 성상 합성(`quality.py`) → 원장 변경 목록 생성(`generate.py`) → 백업·적재·회수(`loader.py`, `__main__.py`) 순으로 동작한다. 화면은 원장 표에만 "더미" 표시를 붙인다.

**기술:** Python 3(표준 `random.Random`, `sqlite3` backup API), pytest, React/TypeScript, Playwright.

**설계 문서:** `docs/superpowers/specs/2026-11-10-dummy-coal-data-design.md`

## 공통 제약

- 실제로 입력된 값은 절대 바꾸지 않는다. 생성기는 `None`인 칸만 채운다.
- 시드 기본값 `20261110`. 하위 시드는 `f"{seed}:{voyage_number}:{coal_name}"` 문자열로 `random.Random`을 만든다(파이썬 `hash` 금지).
- 항차 범위: `26-1-001`~`26-1-041`, `26-2-001`~`26-2-022`, `26-3-001`~`26-3-038`(합계 101건).
- 더미 항차: `classification='actual'`, `data_origin='dummy'`, `status='completed'`. 미래 입항 선박은 만들지 않는다.
- 분석기관 문자열은 정확히 `더미(공개 일반값)`. 적재 actor는 `dummy-seed`, 원장 origin은 `dummy-data`.
- 사내 자료·계약값·사진에서 옮긴 값 금지. 성상 범위는 공개 자료 조사 파일에서만 가져온다.
- 화면의 더미 표시는 원장(공용 항차 DB) 표·상세에만 둔다. 다른 업무 화면에 더미 문구를 반복하지 않는다(AGENTS.md 해커톤 데이터 경계).
- Claude는 ZGX에 쓰지 않는다. ZGX 실행 명령은 사용자에게 붙여 넣을 명령으로만 준다.
- 백엔드 시험은 `X:\IDEWorkspace\ws_codex\Hackathon_EWP\backend\.venv\Scripts\python.exe -m pytest`로 돌린다. 알려진 highspy 실패(test_annual_headroom 2건, test_headroom_uc 가져오기)는 제외하고 판단한다.
- 커밋마다 이번 파일만 지정해서 stage한다. 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 검토 초점

1. **사람이 더미 칸을 고친 뒤 회수** — 고친 칸은 남고, 고친 칸이 있는 더미 행은 지워지지 않아야 한다(과제 6 시험).
2. **실제 행의 상태·실적 칸** — `status=arrived`인 실제 항차에 실적 시각(`actual_*`)이나 하역 분석을 만들면 안 된다. 선적 분석만 만든다(과제 5 시험).
3. **원장 화면·API로 더미 표시를 위조** — 수기·엑셀 저장에서 `data_origin`·`dummy_fields`를 보내면 무시되어야 한다(과제 1 시험).
4. **같은 부두 하역 시간 겹침** — 생성한 일정에서 같은 부두의 접안~하역완료 구간이 겹치면 안 된다(과제 5 시험).
5. **두 번째 적재** — 이미 더미가 들어간 DB에 다시 `load`하면 원장 revision이 오르지 않아야 한다(과제 6 시험).

---

### 과제 1: 원장 계약 칸 추가와 더미 칸 보호

**파일:**
- 수정: `backend/src/midterm/voyage_registry.py`
- 수정: `backend/src/midterm/voyage_registry_excel.py` (system 칸 제외)
- 수정: `docs/DATA_DICTIONARY.md` (공용 수기 항차 원장 절에 새 칸 설명)
- 시험: `backend/tests/test_voyage_registry.py`

**인터페이스:**
- 생산: `SCHEMA[entity]['fields']`에 `system=True` 표시가 붙은 `data_origin`(choice: `entered`/`dummy`/`mixed`), `dummy_fields`(text, 최대 2000자, kind `memo`)를 voyages·cargo·assays에 추가. voyages에 `laytime_hours`(number 0~1000), `demurrage_usd_per_day`(number 0~1000000). assays에 `fe2o3`(number 0~100, group `회성분 분석 · %wt`, `tio2` 다음 위치).
- 생산: `commit(changes, revision, actor, origin, path)`의 origin 허용값에 `'dummy-data'` 추가. `_prepare(changes, current, origin='manual')`.
- 생산: `purge(keys, revision, actor, origin, path) -> dict` — `keys`는 `{'assays': [...], 'cargo': [...], 'voyages': [...]}`, assays→cargo→voyages 순으로 삭제하고 각 행마다 audit(`after_json='null'`)을 남기며 revision을 1 올린다. origin은 `'dummy-data'`만 허용.
- 생산: 헬퍼 `dummy_keys(row: dict, entity: str) -> set[str]` — `data_origin=='dummy'`이면 키 칸을 뺀 값 있는 모든 칸, `mixed`면 `dummy_fields`를 쉼표로 나눈 집합, 아니면 빈 집합.

- [ ] **1단계: 실패하는 시험 작성**

```python
def test_migration_marks_existing_rows_entered(tmp_path):
    # 새 칸이 없는 옛 표를 만든 뒤 init_schema → 모든 행 data_origin == 'entered', dummy_fields is None

def test_manual_commit_cannot_set_dummy_markers(tmp_path):
    # origin='manual'로 data_origin='dummy', dummy_fields='cv'를 보내면 저장 후 data_origin=='entered', dummy_fields is None

def test_human_edit_removes_field_from_dummy_fields(tmp_path):
    # origin='dummy-data'로 화물 cv·sulfur_pct 채움(data_origin='mixed', dummy_fields='cv,sulfur_pct')
    # origin='manual'로 cv만 수정 → dummy_fields=='sulfur_pct', data_origin=='mixed'
    # 다시 sulfur_pct 수정 → dummy_fields is None, data_origin=='entered'

def test_human_edit_of_dummy_row_becomes_mixed(tmp_path):
    # data_origin='dummy' 항차의 notes를 manual로 수정 → data_origin=='mixed', dummy_fields에 notes 없음, status 등 나머지 값 칸은 포함

def test_purge_deletes_children_first_and_audits(tmp_path):
    # 항차·화물·분석 1건씩 넣고 purge → 세 표 모두 0행, audit에 after_json=='null' 3건, revision +1

def test_purge_rejects_non_dummy_origin(tmp_path):
    # purge(..., origin='manual') → RegistryError

def test_excel_template_excludes_system_fields():
    # workbook 헤더에 '더미 구분'·'더미 칸' 라벨이 없다

def test_api_commit_still_rejects_dummy_origin(...):
    # test_voyage_registry_api.py: 수기 저장 API로 저장된 audit origin은 'manual'뿐이다(기존 픽스처 사용)
```

- [ ] **2단계: 실패 확인** — `...python.exe -m pytest backend/tests/test_voyage_registry.py -k "dummy or purge or migration or system" -v` → 새 시험 FAIL.

- [ ] **3단계: 구현**
  - `_prepare`의 값 결정 루프에서 `f.get('system')` 칸은 origin이 `'dummy-data'`가 아니면 입력값을 버리고 기존 행 값(새 행이면 `'entered'`/`None`)을 쓴다.
  - origin이 `'dummy-data'`가 아니고 기존 행의 `dummy_keys`와 바뀐 칸이 겹치면: 남은 더미 칸 = `dummy_keys(before) - 바뀐 칸`. 남은 칸이 있으면 `data_origin='mixed'`, `dummy_fields=','.join(sorted(남은 칸))`, 없으면 `'entered'`/`None`.
  - 마이그레이션: 기존 재생성 경로가 새 칸을 만든 뒤 `UPDATE ... SET data_origin='entered' WHERE data_origin IS NULL`을 세 표에 실행한다.
  - 엑셀 내보내기·읽기 모두 `system` 칸을 건너뛴다.
  - 라벨: `data_origin` = `더미 구분`, `dummy_fields` = `더미 칸`, `laytime_hours` = `허용정박시간(h)`, `demurrage_usd_per_day` = `체선료(USD/일)`, `fe2o3` = `Fe2O3`.
  - DATA_DICTIONARY에 네 칸과 회수 규칙 두 줄을 추가한다.

- [ ] **4단계: 통과 확인** — 위 명령 PASS, 이어서 `-m pytest backend/tests/test_voyage_registry.py backend/tests/test_voyage_registry_api.py backend/tests/test_voyage_business.py` 전부 PASS.

- [ ] **5단계: 커밋** — `feat(registry): add dummy-origin markers, laytime fields and Fe2O3 to the voyage registry`

---

### 과제 2: 기준재고 허용 칸 추가

**파일:**
- 수정: `backend/src/midterm/stock_baseline.py`
- 시험: `backend/tests/test_stock_baseline.py`

**인터페이스:**
- 생산: `save_baseline`의 허용 칸에 `temperature_c`(숫자, 0~150, 음수·bool·무한대 거부)와 `dummy_fields`(문자열 ≤200 또는 None) 추가. 나머지 동작은 그대로.

- [ ] **1단계: 실패하는 시험**

```python
def test_baseline_accepts_temperature_and_dummy_fields(tmp_path):
    # lots=[{..., 'temperature_c': 41.5, 'dummy_fields': 'age_days,temperature_c'}] 저장 후 read_baseline 값 그대로

@pytest.mark.parametrize('bad', [-1, 151, True, float('inf'), '40'])
def test_baseline_rejects_bad_temperature(tmp_path, bad): ...  # ValueError
```

- [ ] **2단계: 실패 확인** — `-m pytest backend/tests/test_stock_baseline.py -v` → 새 시험 FAIL.
- [ ] **3단계: 구현** — 허용 집합과 검사만 추가한다.
- [ ] **4단계: 통과 확인** — 같은 명령 PASS.
- [ ] **5단계: 커밋** — `feat(baseline): allow pile temperature and dummy markers in yard baselines`

---

### 과제 3: 성상 표·부두 표와 읽기 모듈

**파일:**
- 생성: `backend/src/midterm/dummy_data/__init__.py` (빈 파일 + 모듈 설명 한 줄)
- 생성: `backend/src/midterm/dummy_data/coal_profiles.json`
- 생성: `backend/src/midterm/dummy_data/berths.json`
- 생성: `backend/src/midterm/dummy_data/profiles.py`
- 시험: `backend/tests/test_dummy_profiles.py`

**입력 자료(저장소 밖, 작업자에게 경로로 전달):**
- 탄종별 성상 조사: `C:\Users\weste\AppData\Local\Temp\claude\86092d026f74e9c6\960f5ff4-eae5-49d0-af63-38fbf921a54d\scratchpad\coal-specs.json`
- 발전사 고열량·저열량 수입 범위 조사: 같은 폴더의 `korea-import-ranges.json`

**`coal_profiles.json` 형식:**

```json
{
  "classification": "dummy",
  "note": "공개 자료 기반 일반값. 사내·계약 자료 아님.",
  "classes": {"high_cv": {"gcv_arb_min": 0, "gcv_arb_max": 0, "sulfur_ar_max": 0, "source": "..."},
              "low_cv":  {"gcv_arb_min": 0, "gcv_arb_max": 0, "sulfur_ar_max": 0, "source": "..."}},
  "coals": {
    "AVRA": {"origin": "...", "grade": "...", "class": "high_cv", "anthracite": false,
             "confidence": "근거있음|추정", "sources": ["https://..."],
             "fields": {"gcv_arb": {"typ": 6300, "min": 6048, "max": 6552}, "...": {}}}
  }
}
```

- `fields` 키는 원장 칸 이름으로 바꾼다: GAR→`gcv_arb`, TM→`tm_ar`, IM→`im_adb`, VM→`vm_adb`, Ash→`ash_adb`, FC→`fc_adb`, S_AR→`sulfur_ar`, C/H/N/O/S→`c_db`…`s_db`, HGI→`hgi`, CSN→`csn`, IT/ST/HT/FT→`fusion_it`…`fusion_ft`, Cl→`chlorine_db_ppm`(%면 ×10000), 회성분→`sio2`…`tio2`, `fe2o3`, `ash_other`. NAR·GAD는 담지 않는다(생성 시 계산).
- 탄종 10개 키는 원장 표기 그대로: `AVRA`, `MERCURIA`, `Flame`, `Glencore`, `Glencore(무연탄)`, `Centennial`, `KCH(Kaltim)`, `KCH(adaro)`, `KCH(Arutmin)`, `LXI`.
- `class`는 `korea-import-ranges.json`의 고열·저열 경계로 정한다. 각 탄종의 `gcv_arb` 범위가 자기 등급 범위 안에 들도록 조정하고, 조정 근거를 `note`에 쓴다.
- MERCURIA는 KCH(Arutmin)와 값이 같으므로 `typ`을 범위 안에서 옮긴다: `gcv_arb` −150, `tm_ar` +1.5, `sulfur_ar` −0.12, `ash_adb` +1.0(원소·공업 합계는 생성 시 맞춤). `confidence`는 `추정`.

**`berths.json`:**

```json
{"classification": "dummy", "note": "시연용 가정값. 실제 부두 능력 자료로 교체 예정.",
 "berths": {
   "BD-1": {"unload_tph": 1800, "work_hours_per_day": 20, "max_dwt": 180000, "yards": ["1","2"]},
   "BD-2": {"unload_tph": 1500, "work_hours_per_day": 20, "max_dwt": 100000, "yards": ["2","3"]},
   "BD-3": {"unload_tph": 1500, "work_hours_per_day": 20, "max_dwt": 100000, "yards": ["3"]}},
 "outage_examples": [{"berth": "BD-2", "start": "2026-11-20T08:00:00+09:00", "end": "2026-11-21T20:00:00+09:00", "reason": "하역기 정비(예시)"}]}
```

**인터페이스:**
- 생산: `profiles.py`
  - `load_profiles(path: Path | None = None) -> dict` — 파일을 읽고 `validate_profiles` 통과본을 돌려준다.
  - `validate_profiles(data: dict) -> list[str]` — 오류 문구 목록. 검사: 탄종 10개 모두 있음, 모든 `min ≤ typ ≤ max`, 원장 칸의 `min/max` 안, `fusion_*` typ 오름차순, `class` 값이 두 종류 중 하나, `gcv_arb.typ`이 자기 등급 범위 안.
  - `load_berths(path: Path | None = None) -> dict`

- [ ] **1단계: 실패하는 시험**

```python
def test_profiles_cover_all_registry_coals():
    assert set(load_profiles()['coals']) == {'AVRA','MERCURIA','Flame','Glencore','Glencore(무연탄)','Centennial','KCH(Kaltim)','KCH(adaro)','KCH(Arutmin)','LXI'}

def test_profiles_are_valid_and_marked_dummy():
    data = load_profiles(); assert data['classification'] == 'dummy'; assert validate_profiles(data) == []

def test_every_coal_has_source_or_estimate_label():
    for c in load_profiles()['coals'].values():
        assert c['confidence'] in ('근거있음', '추정'); assert c['confidence'] == '추정' or c['sources']

def test_mercuria_differs_from_arutmin():
    coals = load_profiles()['coals']; assert coals['MERCURIA']['fields'] != coals['KCH(Arutmin)']['fields']

def test_validate_catches_out_of_order_range():
    data = load_profiles(); data['coals']['LXI']['fields']['tm_ar']['min'] = 99
    assert validate_profiles(data)

def test_berths_cover_three_berths():
    assert set(load_berths()['berths']) == {'BD-1','BD-2','BD-3'}
```

- [ ] **2단계: 실패 확인** — `-m pytest backend/tests/test_dummy_profiles.py -v` → FAIL(모듈 없음).
- [ ] **3단계: 두 JSON을 만들고 `profiles.py` 구현** — JSON 변환은 일회성 스크립트를 scratchpad에 두고 결과만 커밋한다.
- [ ] **4단계: 통과 확인** — 같은 명령 PASS.
- [ ] **5단계: 커밋** — `feat(dummy-data): add public-range coal profiles and assumed berth table`

---

### 과제 4: 성상 분석 합성과 일관성 검사

**파일:**
- 생성: `backend/src/midterm/dummy_data/quality.py`
- 시험: `backend/tests/test_dummy_quality.py`

**인터페이스:**
- 소비: 과제 3 `load_profiles()['coals'][name]`
- 생산:
  - `make_loading_assay(profile: dict, rng: random.Random) -> dict` — 원장 assays 성상 칸만 담은 dict(키·cargo_no·날짜 제외).
  - `make_unloading_assay(loading: dict, rng: random.Random) -> dict`
  - `check_assay(a: dict) -> list[str]` — 어긴 규칙 문구 목록(빈 목록이면 통과).
  - `cargo_summary(a: dict) -> dict` — 화물 칸 `cv, cv_basis='GAR', moisture_pct, ash_pct, sulfur_pct, analysis_basis='AR'`.

**합성 규칙(작업자가 정할 수 없는 값):**
- 표본: 각 칸 `typ + N(0, (max−min)/6)`을 `[min,max]`로 자른다. 소수 자리: 발열량 정수, 백분율 2자리, 회융점·연소온도 정수, HGI·CSN 1자리(CSN은 0.5 단위).
- 공업분석(ADB): IM·VM·Ash 표본 후 `FC = 100 − IM − VM − Ash`. FC가 범위를 벗어나면 VM을 조정한다.
- 원소분석(DB): `ash_db = ash_adb×100/(100−im_adb)`. C·H·N·S 표본 후 `O = 100 − C − H − N − S − ash_db`, O < 2면 C를 줄인다. `s_db`와 `sulfur_ar = s_db×(100−tm_ar)/100`.
- 발열량: `gcv_db` = `gcv_arb.typ 표본 ×100/(100−tm_ar)`로 먼저 정하고 `gcv_arb = gcv_db×(100−tm)/100`, `gcv_adb = gcv_db×(100−im)/100`. `ncv = gcv_arb − 5.83×(9×h_db×(100−tm)/100 + tm)`, `ncv_basis='AR'`.
- 회성분: 표본 후 `ash_other = 100 − 나머지 합`, 음수면 SiO2를 줄인다.
- 회융점: IT 표본, ST=IT+U(20,60), HT=ST+U(10,40), FT=HT+U(10,50).
- 연소특성(공개 일반값, 탄종 무관): 시작 250~340, 최대연소 400~480, 종료 560~680 °C, 최대연소속도 5~15 %/min. 휘발분이 높을수록 시작온도를 낮춘다(`340 − (vm_adb−25)×3`을 범위로 자름).
- 입도: `size_2mm` 20~35, `size_025mm` 5~12(≤ size_2mm).
- 옛 호환 칸: `cv=gcv_arb`, `cv_basis='GAR'`, `moisture_pct=tm_ar`, `ash_pct=ash_adb×(100−tm)/(100−im)`, `sulfur_pct=sulfur_ar`, `volatile_pct`·`fixed_carbon_pct`는 같은 AR 환산, `analysis_basis='AR'`.
- 하역 분석: 선적 분석을 복사하고 `tm_ar += U(0,1.5)`, AR 값(`gcv_arb`, `sulfur_ar`, `ncv`, 옛 호환 칸)만 새 TM으로 다시 계산한다. DB·ADB 값은 그대로.
- `result_status='confirmed'`, `laboratory='더미(공개 일반값)'`.

- [ ] **1단계: 실패하는 시험**

```python
@pytest.mark.parametrize('name', ALL_COALS)
@pytest.mark.parametrize('seed', range(20))
def test_assays_pass_all_consistency_rules(name, seed):
    p = load_profiles()['coals'][name]; rng = random.Random(f'{seed}:{name}')
    a = make_loading_assay(p, rng); u = make_unloading_assay(a, rng)
    assert check_assay(a) == [] and check_assay(u) == []

def test_check_assay_rules():
    # 정상 표본에서 하나씩 깨뜨리면 해당 문구가 나온다:
    # im+vm+ash+fc=100±0.1, 원소+ash_db=100±0.5, gcv_arb<gcv_adb<gcv_db, ncv<gcv_arb,
    # |sulfur_ar − s_db×(100−tm)/100| ≤ 0.01 그리고 sulfur_pct==sulfur_ar,
    # 회성분 합 100±0.5, IT≤ST≤HT≤FT, 원장 SCHEMA 칸 min/max, size_025mm≤size_2mm

def test_unloading_moisture_rises_and_ar_heat_falls():
    # 0 ≤ u.tm_ar − a.tm_ar ≤ 1.5, u.gcv_arb ≤ a.gcv_arb, u.gcv_db == a.gcv_db

def test_same_seed_same_assay(): ...

def test_cargo_summary_uses_ar_basis():
    # cargo_summary(u) == {'cv': u['gcv_arb'], 'cv_basis': 'GAR', 'moisture_pct': u['tm_ar'], 'ash_pct': ..., 'sulfur_pct': u['sulfur_ar'], 'analysis_basis': 'AR'}
```

- [ ] **2단계: 실패 확인** — `-m pytest backend/tests/test_dummy_quality.py -v` → FAIL.
- [ ] **3단계: 구현**
- [ ] **4단계: 통과 확인** — PASS(200건 매개변수 포함).
- [ ] **5단계: 커밋** — `feat(dummy-data): synthesize internally consistent coal assays`

---

### 과제 5: 원장 변경 목록 생성기

**파일:**
- 생성: `backend/src/midterm/dummy_data/generate.py`
- 시험: `backend/tests/test_dummy_generate.py`
- 시험 고정 자료: `backend/tests/fixtures/dummy_registry_snapshot.json` — ZGX 형태를 흉내 낸 **가상** 스냅샷(실제 관리ID·선박ID를 복사하지 않는다). 실제 12건과 같은 번호·탄종·상태 조합(26-1-001 completed·하역완료 `2026-01-16T00:00:00+09:00`, 나머지 11건 arrived), 모의 항차 2건, 기준재고 6개 파일(as_of `2026-11-08`)을 담는다.

**인터페이스:**
- 소비: 과제 3 `load_profiles`, `load_berths`; 과제 4 `make_loading_assay`, `make_unloading_assay`, `check_assay`, `cargo_summary`; 과제 1의 칸 이름.
- 생산:

```python
@dataclass
class DummyPlan:
    changes: dict          # {'voyages': [...], 'cargo': [...], 'assays': [...]} — commit에 그대로 넣는 형식
    baseline: dict | None  # {'as_of': ..., 'lots': [...]} 보완본, 바뀐 것이 없으면 None
    stats: dict            # {'create': {...}, 'fill': {...}, 'kept_real_values': int}

def generate(snapshot: dict, baseline: dict, *, seed: int = 20261110,
             profiles: dict | None = None, berths: dict | None = None) -> DummyPlan
```

**규칙(작업자가 정할 수 없는 값):**
- 대상 판단: `classification=='simulation'` 항차와 그 화물·분석은 건드리지 않는다. 실제 항차는 `voyage_number`로 찾는다.
- 새 키: 항차 `DV-{voyage_number}`, 화물 `DC-{voyage_number}`, 분석 `DA-{voyage_number}-L` / `-U`(실제 화물에 붙는 분석도 같은 규칙, 화물 키는 실제 `cargo_no`). 선박(`ship_code`)은 만들지 않는다.
- 새 행에는 `data_origin='dummy'`, `dummy_fields=None`. 실제 행 채움 변경에는 `{키, 채운 칸들, data_origin:'mixed', dummy_fields: ','.join(sorted(채운 칸 ∪ 기존 dummy_fields))}`만 담는다. 채울 칸이 없으면 변경을 만들지 않는다. 이미 `data_origin='dummy'`인 행은 같은 값을 다시 만들어 넣는다(차이 없음 → commit이 무시).
- 탄종 배정: 실제 화물 탄종 → 기준재고 `voyage_number`의 탄종 → 나머지는 부두별 가중치(그 부두의 실제·기준재고 탄종 건수 + 0.5, 비무연탄 10종 대상)로 하위 시드 추첨. `Glencore(무연탄)`은 전체 101건 중 5건(=floor(0.05×101))에 도달하면 가중치 0, 그 전에는 0.2.
- 선형·물량: AVRA·Glencore·Centennial은 40% Capesize(B/L 120,000~170,000t), 나머지 Panamax(60,000~85,000t). `received_t = bl_t × (1 + U(−0.005, 0.005))`, 1t 단위 반올림. 실제 화물의 B/L·입고량은 그대로.
- 선적지: 탄종의 원산지로 `origin_port`, `loading_country`, 화물 `origin_country`, `supplier`(탄종 표시명)를 채운다. 항해일: 인도네시아 8~10일, 호주 12~14일, 러시아 5~7일. `destination_port='당진'`, `destination_plant_id='dangjin'`.
- 일정(부두별, 번호 오름차순):
  - 기준점: 일련번호 0 = `2026-01-01T00:00+09:00`, 실제 실적 하역완료가 있는 항차(26-1-001)는 그 시각, 각 부두의 마지막 실제 번호 묶음의 첫 번호 = 기준재고 as_of − 10일.
  - 기준점 사이 번호의 입항 예정 시각은 선형 보간 + U(−12h, +12h).
  - 접안 = 입항 + U(2h, 18h), 하역완료 = 접안 + `bl_t / unload_tph / work_hours_per_day × 24`시간.
  - 같은 부두에서 직전 항차 하역완료보다 접안이 빠르면 접안을 직전 하역완료 + 2h로 민다(겹침 금지).
  - 더미 항차: `planned_*`와 `actual_*` 4개 시각 모두, `status='completed'`, `berth_id='BD-{부두}'`, `yard`는 `berths.json`의 `yards`에서 시드 추첨(기준재고에 위치가 있으면 그 처).
  - 실제 항차: `planned_departure`, `planned_arrival`만 채운다. `status`, `actual_*`, `planned_berth`, `planned_unload_end`는 건드리지 않는다. 단 `status=='completed'`인 실제 항차는 `planned_*` 4개를 채운다.
- 체선: `laytime_hours` U(72,120) 정수, `demurrage_usd_per_day` Capesize U(25000,35000), Panamax U(15000,25000), 500 단위.
- 분석: 하역 완료 항차(더미 전부, 실제 completed)는 선적·하역 2건, 그 외 실제 항차는 선적 1건. 채취일 = 선적: 선적항 출항일, 하역: 하역완료일. 분석일 = 채취일 + 2일. `report_no = 'DUMMY-' + 분석 키`. 화물 대표 성상은 하역 분석이 있으면 하역, 없으면 선적 분석으로 `cargo_summary`.
- 기준재고 보완: 각 파일에서 `age_days`가 None이면 연결 항차의 하역완료일(없으면 입항 예정일)부터 as_of까지 일수. `temperature_c`가 None이면 `25 + min(age_days, 180)/180×25 + (저열이면 8 else 0) + U(−2,2)`를 25~60으로 자르고 소수 1자리. 채운 칸을 그 파일의 `dummy_fields`에 쉼표로 기록. `grade`가 비어 있으면 성상 표 `class`로 `고열`/`저열`을 적는다(이 칸도 `dummy_fields`에 포함).
- 생성 끝에 모든 분석에 `check_assay`, 모든 항차에 일정 순서·겹침 검사를 돌려 하나라도 어기면 `ValueError`.

- [ ] **1단계: 실패하는 시험**

```python
def test_generates_full_voyage_range(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    created = {r['voyage_number'] for r in plan.changes['voyages'] if r['voyage_no'].startswith('DV-')}
    assert len(created) == 89
    assert created | fixture.real_numbers == ALL_101_NUMBERS

def test_same_seed_same_plan_and_other_seed_differs(fixture): ...

def test_real_values_are_never_overwritten(fixture):
    # 모든 실제 행 변경에서 기존 값이 있던 칸이 변경 dict에 없다

def test_real_arrived_voyages_get_no_actuals_or_unloading_assay(fixture):
    # status=='arrived' 실제 항차 변경에 actual_*·status 없음, 그 화물의 분석은 '-L' 1건뿐

def test_coal_assignment_keeps_known_coals_and_caps_anthracite(fixture):
    # 실제·기준재고 항차 탄종 유지, 무연탄 화물 수 ≤ 5

def test_no_berth_overlap_and_dummy_voyages_are_past(fixture):
    # 부두별 [actual_berth, actual_unload_end] 구간 겹침 없음, 더미 항차 하역완료 < as_of

def test_cargo_volumes_and_receipt_tolerance(fixture):
    # Panamax/Capesize 범위, |received/bl − 1| ≤ 0.005

def test_demurrage_and_laytime_ranges(fixture): ...

def test_simulation_rows_untouched(fixture): ...

def test_baseline_fill_marks_dummy_fields_and_bounds_temperature(fixture):
    # 25 ≤ temperature_c ≤ 60, 원래 있던 age_days 그대로, dummy_fields에 채운 칸만

def test_plan_commits_cleanly_into_empty_registry(tmp_path, fixture):
    # fixture 스냅샷을 tmp DB에 넣고 commit(plan.changes, rev, 'dummy-seed', 'dummy-data') 성공
```

- [ ] **2단계: 실패 확인** — `-m pytest backend/tests/test_dummy_generate.py -v` → FAIL.
- [ ] **3단계: 구현**
- [ ] **4단계: 통과 확인** — PASS.
- [ ] **5단계: 커밋** — `feat(dummy-data): generate deterministic dummy voyages, cargo and assays`

---

### 과제 6: 적재기와 명령줄(check·load·unload)

**파일:**
- 생성: `backend/src/midterm/dummy_data/loader.py`
- 생성: `backend/src/midterm/dummy_data/__main__.py`
- 생성: `docs/DUMMY_DATA.md` (ZGX 실행 절차, 회수 방법, 성상 출처 수준 표)
- 시험: `backend/tests/test_dummy_loader.py`

**인터페이스:**
- 소비: 과제 1 `snapshot`, `commit`, `purge`, `dummy_keys`; 과제 2 `read_baseline`, `save_baseline`; 과제 5 `generate`.
- 생산:
  - `check(path: Path, *, seed=20261110) -> dict` — `{'create': {entity: n}, 'fill_rows': n, 'fill_fields': n, 'kept_real_values': n, 'baseline_fill': n}`, 쓰지 않는다.
  - `backup(path: Path, backup_root: Path | None = None) -> Path` — 기본 `~/.config/genforecast/backups/dummy-YYYYmmdd-HHMMSS/planning.sqlite3`, 환경변수 `GENFORECAST_BACKUP_DIR`가 있으면 그 아래. sqlite3 `Connection.backup` 사용.
  - `load(path: Path, *, seed=20261110, backup_root=None) -> dict` — 백업 → `commit(..., actor='dummy-seed', origin='dummy-data')` → 기준재고 보완본 저장(actor `dummy-seed`, 바뀐 게 없으면 저장 안 함). 결과에 백업 경로·revision·건수.
  - `unload(path: Path, *, backup_root=None) -> dict` — 백업 → 현재 원장에서
    - `data_origin=='dummy'` 행(키 접두 `DV-`/`DC-`/`DA-`)은 `purge`.
    - `data_origin=='mixed'` 행은 `dummy_keys`의 칸을 None으로 하는 변경을 `commit(origin='dummy-data')`하되 `data_origin='entered'`, `dummy_fields=None`. 사람이 고친 칸은 과제 1 규칙으로 이미 `dummy_fields`에서 빠져 있으므로 남는다.
    - 더미 접두 키지만 `mixed`인 행(사람이 고친 더미 행)은 지우지 않고 위 규칙으로 더미 칸만 비운다. 필수 칸(`status`, `coal_name`, `destination_plant_id`, `stage`, 화물의 `bl_t`)은 비우지 않고 결과의 `kept_required`에 키를 적는다.
    - 기준재고: 최신 판의 각 파일에서 `dummy_fields`에 적힌 칸과 `dummy_fields`를 지운 새 판을 저장(바뀐 게 없으면 저장 안 함).
  - `__main__.py`: `python -m midterm.dummy_data {check|load|unload} [--db PATH] [--seed N]`. `--db` 기본값 `midterm.database.DATABASE`(=`MIDTERM_PLANNING_DB`). 결과를 한국어 요약 줄과 JSON 한 줄로 출력. `load`·`unload`는 `--yes` 없이 실행하면 check 결과만 보여 주고 종료.

- [ ] **1단계: 실패하는 시험** (임시 DB + 과제 5 고정 자료)

```python
def test_check_does_not_write(tmp_db): ...                       # 파일 mtime·revision 그대로
def test_load_fills_blanks_only_and_creates_backup(tmp_db, tmp_path):
    # 실제 값 그대로, 백업 파일 존재·열림, 원장 audit origin=='dummy-data'
def test_second_load_is_noop(tmp_db): ...                        # registry revision·baseline revision 그대로
def test_unload_restores_original_snapshot(tmp_db):
    # load → unload 후 세 표의 행·값이 load 전과 같음(updated_*, data_origin 제외하고 비교), 기준재고 lots 동일
def test_unload_keeps_human_edits(tmp_db):
    # load → manual로 실제 화물 cv 수정, 더미 항차 notes 수정 → unload
    # 수정한 cv 유지, 그 더미 항차 행 남음(notes 유지), 다른 더미 행은 사라짐
def test_cli_requires_yes(tmp_db, capsys): ...                   # 'load' 단독 실행은 쓰지 않음
```

- [ ] **2단계: 실패 확인** — `-m pytest backend/tests/test_dummy_loader.py -v` → FAIL.
- [ ] **3단계: 구현** — `docs/DUMMY_DATA.md`에 ZGX 명령 세 줄(`check`, `load --yes`, `unload --yes`)과 실행 파이썬 경로 `/home/puyo/genforecast/current/.venv/bin/python`, 대상 DB 환경변수, 백업 위치를 적는다.
- [ ] **4단계: 통과 확인** — PASS, 이어서 백엔드 전체 `-m pytest backend/tests -q` (highspy 3건 외 실패 없음).
- [ ] **5단계: 커밋** — `feat(dummy-data): add reversible check/load/unload commands with backups`

---

### 과제 7: 원장 화면 더미 표시

**파일:**
- 수정: `src/features/vessels/VoyageRegistry.tsx`
- 수정: 원장 기능 CSS 파일(같은 폴더의 `vr-` 클래스가 있는 CSS)
- 시험: `tests/voyage-registry-ui.spec.ts`

**인터페이스:**
- 소비: `/api/voyage-registry/schema` 필드의 `system: true`, 행의 `data_origin`, `dummy_fields`.
- 생산: 표 첫 칸 버튼 뒤 `<span className="vr-dummy-badge">더미</span>`(행이 `dummy` 또는 `mixed`). 상세·성상 표(`vr-quality`)에서 더미 칸 값 옆에 같은 배지. 편집기·엑셀 열 목록에서 `system` 칸 제외. 배지 `title`: 행 더미면 `더미 자료(공개 일반값으로 생성)`, 칸 더미면 `빈칸을 더미로 채운 값`.

- [ ] **1단계: 실패하는 시험** — 기존 시험의 `/api/voyage-registry` 가로채기 방식으로 더미 항차 1건(`data_origin:'dummy'`)과 실제 화물 1건(`data_origin:'mixed'`, `dummy_fields:'cv,sulfur_pct'`)을 돌려준다.

```ts
test("원장 표와 상세에 더미 표시가 보인다", ...)          // 행 배지 1개, 화물 상세의 열량·황분 옆 배지, 입하량 옆 배지 없음
test("편집기에 더미 구분 칸이 없다", ...)                // '더미 구분'·'더미 칸' 라벨 없음
test("다크 모드와 390px에서 배지가 보이고 가로 넘침이 없다", ...)
```

- [ ] **2단계: 실패 확인** — `npm.cmd run test:ui -- tests/voyage-registry-ui.spec.ts` → FAIL.
- [ ] **3단계: 구현** — 배지 색은 기존 경고·보조 색 변수를 쓰고 전역 선택자를 쓰지 않는다.
- [ ] **4단계: 통과 확인** — 같은 명령 PASS.
- [ ] **5단계: 전체 검증** — `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:ui`(오래 걸리면 백그라운드), `git diff --check`. 흔들리는 `integration-ui.spec.ts:201`이 실패하면 단독 재실행 결과를 따로 적는다.
- [ ] **6단계: 커밋** — `feat(registry-ui): mark dummy rows and fields in the voyage ledger`
