from midterm.stacking.recommend import validate_cargo
from midterm.stacking.registry_cargo import cargo_from_voyage, waiting_voyages

PROFILES = {"coals": {"Glencore": {"class": "high_cv"}, "Flame": {"class": "low_cv"}}}


def voyage(no="V1", **extra):
    base = {"voyage_no": no, "ship_code": "S1", "voyage_number": "26-2-001", "status": "arrived",
            "berth_id": "BD-2", "yard": "3", "planned_arrival": "2026-11-12T09:00",
            "actual_unload_end": None}
    base.update(extra)
    return base


def cargo(no="C1", voyage_no="V1", **extra):
    base = {"cargo_no": no, "voyage_no": voyage_no, "destination_plant_id": "dangjin",
            "coal_name": "Glencore", "planned_t": 40000, "bl_t": None, "cv": 5500}
    base.update(extra)
    return base


def register(voyages=None, cargos=None):
    return {"ships": [{"ship_code": "S1", "name": "한빛호"}],
            "voyages": voyages if voyages is not None else [voyage()],
            "cargo": cargos if cargos is not None else [cargo()]}


EMPTY = {"lots": []}


def test_sums_dangjin_cargo_and_maps_berth():
    reg = register(cargos=[cargo("C1", planned_t=40000), cargo("C2", planned_t=None, bl_t=30000),
                           cargo("C3", destination_plant_id="boryeong", planned_t=10000)])
    got, blocked = cargo_from_voyage("V1", reg, EMPTY, PROFILES)
    assert blocked is None
    assert got["tonnes"] == 70000 and got["berth"] == 2
    assert got["source"] == "registry" and got["ref"] == "V1"
    assert got["vessel_name"] == "한빛호" and got["voyage_number"] == "26-2-001"
    assert got["destination_yard"] == 3 and got["cv"] == 5500 and got["grade"] == "고"
    assert validate_cargo(got)["tonnes"] == 70000


def test_cv_none_when_cargo_cv_differs():
    reg = register(cargos=[cargo("C1", cv=5500), cargo("C2", cv=5600)])
    got, _ = cargo_from_voyage("V1", reg, EMPTY, PROFILES)
    assert got["cv"] is None


def test_unknown_voyage_and_no_dangjin_cargo():
    assert cargo_from_voyage("X", register(), EMPTY, PROFILES) == (None, "항차 없음")
    reg = register(cargos=[cargo(destination_plant_id="hadong")])
    assert cargo_from_voyage("V1", reg, EMPTY, PROFILES) == (None, "당진행 화물 없음")


def test_mixed_coal_blocks():
    reg = register(cargos=[cargo("C1"), cargo("C2", coal_name="Flame")])
    assert cargo_from_voyage("V1", reg, EMPTY, PROFILES) == (None, "한 항차 여러 탄종")


def test_missing_berth_blocks():
    reg = register(voyages=[voyage(berth_id=None)])
    assert cargo_from_voyage("V1", reg, EMPTY, PROFILES) == (None, "부두 미배정")


def test_missing_tonnes_blocks():
    reg = register(cargos=[cargo("C1"), cargo("C2", planned_t=None, bl_t=None)])
    assert cargo_from_voyage("V1", reg, EMPTY, PROFILES) == (None, "화물 물량 미확인")


def test_grade_from_baseline_then_profile():
    base = {"lots": [{"coal_name": "Glencore", "grade": "저열량", "tonnes": 1}]}
    got, _ = cargo_from_voyage("V1", register(), base, PROFILES)
    assert got["grade"] == "저"
    got, _ = cargo_from_voyage("V1", register(), EMPTY, PROFILES)
    assert got["grade"] == "고"


def test_grade_unknown_blocks():
    reg = register(cargos=[cargo(coal_name="Unlisted")])
    assert cargo_from_voyage("V1", reg, EMPTY, PROFILES) == (None, "고/저 구분 미확인")


def test_yard_none_when_missing():
    reg = register(voyages=[voyage(yard=None)])
    got, _ = cargo_from_voyage("V1", reg, EMPTY, PROFILES)
    assert got["destination_yard"] is None


def test_waiting_excludes_completed_unloaded_and_already_in_baseline():
    voyages = [
        voyage("V1", planned_arrival="2026-11-14T00:00"),
        voyage("V2", status="completed"),
        voyage("V3", actual_unload_end="2026-11-10T00:00"),
        voyage("V4", voyage_number="26-1-009"),
        voyage("V5", planned_arrival="2026-11-12T00:00"),
        voyage("V6", status="planned"),
        voyage("V7", planned_arrival="2026-11-13T00:00"),
    ]
    cargos = [cargo(f"C{i}", f"V{i}") for i in range(1, 8)]
    cargos[4] = cargo("C5", "V5", coal_name="Unlisted")
    cargos[6] = cargo("C7", "V7", destination_plant_id="hadong")
    reg = register(voyages, cargos)
    base = {"lots": [{"coal_name": "Glencore", "grade": "고열량", "voyage_number": "26-1-009", "tonnes": 1}]}
    got = waiting_voyages(reg, base, PROFILES)
    assert [g["voyage_no"] for g in got] == ["V5", "V1"]
    assert got[0]["cargo"] is None and got[0]["blocked"] == "고/저 구분 미확인"
    assert got[1]["cargo"]["tonnes"] == 40000 and got[1]["blocked"] is None
    assert got[1]["vessel_name"] == "한빛호"
