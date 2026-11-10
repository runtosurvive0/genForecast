import pytest

from midterm.stacking import MAX_OPTIONS, load_layout, load_routes, recommend, validate_cargo

LAYOUT = load_layout()
ROUTES = load_routes()
LENGTH = {pid: spec["length_m"] for pid, spec in LAYOUT["piles"].items()}


def lot(location, start=None, end=None, tonnes=None, grade="저열량", **extra):
    if tonnes is None:
        tonnes = (end - start) * 150 if start is not None and end is not None else 1000
    row = {"location": location, "coal_name": "탄", "tonnes": tonnes, "voyage_number": "V1",
           "grade": grade, "age_days": 5, "temperature_c": 20, "start_m": start, "end_m": end}
    row.update(extra)
    return row


def full(*piles, grade="저열량"):
    return [lot(p, 0, LENGTH[p], grade=grade) for p in piles]


def full_sheds(skip=(), grade="저열량"):
    return [lot(f"{s}{i}", grade=grade) for s in "AB" for i in range(1, 11) if f"{s}{i}" not in skip]


def base(lots, as_of="2026-11-08"):
    return {"revision": 1, "as_of": as_of, "lots": lots, "total_t": sum(l["tonnes"] for l in lots)}


def cargo(**over):
    value = {"source": "scenario", "ref": "S1", "vessel_name": "선박", "voyage_number": "V9",
             "coal_name": "탄", "grade": "저", "cv": 4800, "tonnes": 6000, "berth": 1,
             "destination_yard": None}
    value.update(over)
    return value


def run(c, lots):
    return recommend(c, base(lots), LAYOUT, ROUTES)


def targets(result):
    return [[p["target"] for p in o["placements"]] for o in result["options"]]


def test_single_fit_prefers_destination_yard():
    r = run(cargo(tonnes=10000, destination_yard=2), full("P3"))
    first = r["options"][0]
    assert first["rank"] == 1
    assert first["placements"][0]["target"] == "Pile 5"
    assert first["placements"][0]["yard"] == 2
    assert first["placements"][0]["tonnes"] == 10000
    assert "2저탄장(목적지)" in first["reasons"]
    assert "한 곳에 모두 적치" in first["reasons"]
    assert r["as_of"] == "2026-11-08"
    assert r["blocked"] is None and r["no_fit"] is None


def test_route_excludes_unreachable_pile():
    lots = full("P1", "P2", "P4", "P5", "P6", "P7", "P8") + full_sheds()
    r = run(cargo(berth=2), lots)
    assert r["options"] == []
    assert r["no_fit"]["message"] == "들어갈 빈 곳 없음"
    assert r["no_fit"]["largest"] is None


def test_adjacent_other_grade_excluded_distant_allowed():
    r = run(cargo(tonnes=6000), [lot("P1", 0, 100, grade="고열량")])
    assert r["options"]
    for option in r["options"]:
        for p in option["placements"]:
            if p["target"] == "Pile 1":
                assert p["from_m"] != 100
    lots = [lot("P1", 300, 420, grade="고열량")] + full("P2", "P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(tonnes=6000), lots)
    first = r["options"][0]["placements"][0]
    assert (first["target"], first["from_m"], first["to_m"]) == ("Pile 1", 0, 40)


def test_unknown_neighbour_grade_warns():
    lots = [lot("P1", 0, 100, grade=None)] + full("P2", "P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(), lots)
    assert targets(r) == [["Pile 1"]]
    assert "옆 구간 원탄 등급 미확인" in r["options"][0]["warnings"]


def test_same_voyage_neighbour_allowed():
    lots = [lot("P1", 0, 100, voyage_number="V9")] + full("P2", "P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(voyage_number="V9"), lots)
    assert targets(r) == [["Pile 1"]]
    assert r["options"][0]["placements"][0]["from_m"] == 100


def test_risky_neighbour_ranks_lower():
    lots = [lot("P1", 0, 100, age_days=40), lot("P2", 0, 100)] + full("P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(), lots)
    assert targets(r) == [["Pile 2"], ["Pile 1"]]
    assert "옆 구간에 오래되거나 뜨거운 원탄 없음" in r["options"][0]["reasons"]
    second = r["options"][1]
    assert any("적치 40일" in w for w in second["warnings"])
    assert "옆 구간 탄 원탄 적치 40일" in second["warnings"]
    assert "옆 구간에 오래되거나 뜨거운 원탄 없음" not in second["reasons"]


def test_hot_neighbour_warns():
    lots = [lot("P1", 0, 100, temperature_c=45)] + full("P2", "P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(), lots)
    assert "옆 구간 탄 원탄 45°C" in r["options"][0]["warnings"]


def test_split_into_two_when_no_single_fit():
    lots = [lot("P1", 0, 370, tonnes=37000), lot("P2", 0, 370, tonnes=37000)]
    lots += full("P3", "P4", "P5", "P6", "P7", "P8") + full_sheds()
    r = run(cargo(tonnes=8000, destination_yard=1), lots)
    first = r["options"][0]
    assert len(first["placements"]) == 2
    assert sum(p["tonnes"] for p in first["placements"]) == 8000
    assert {p["yard"] for p in first["placements"]} == {1}
    assert first["placements"][0]["tonnes"] == 5000
    assert "한 곳에 모두 적치" not in first["reasons"]
    assert "1저탄장(목적지)" in first["reasons"]
    assert len({tuple(sorted(t)) for t in targets(r)}) == len(r["options"])


def test_split_not_made_when_single_fit_exists():
    r = run(cargo(tonnes=6000), full("P3"))
    assert all(len(o["placements"]) == 1 for o in r["options"])


def test_no_fit_reports_largest_gap():
    lots = [lot("P1", 0, 370, tonnes=37000), lot("P2", 0, 390, tonnes=39000)]
    lots += full("P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(tonnes=20000), lots)
    assert r["options"] == []
    assert r["no_fit"] == {
        "message": "들어갈 빈 곳 없음",
        "largest": {"yard": 1, "target": "Pile 1", "from_m": 370, "to_m": 420, "tonnes": 5000},
    }


def test_unplaced_pile_excluded_and_reported():
    r = run(cargo(), [lot("P6")])
    assert "구간 미확인: Pile 6" in r["gaps"]
    assert all("Pile 6" not in t for ts in targets(r) for t in ts)


def test_shed_empty_cell_and_capacity():
    lots = full("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8") + full_sheds(skip=("A3",))
    r = run(cargo(tonnes=20000), lots)
    first = r["options"][0]
    assert first["placements"] == [{"yard": 3, "target": "Shed A 3칸", "from_m": None, "to_m": None, "tonnes": 20000}]
    assert "Shed 칸 용량 모의 값" in first["assumptions"]
    assert "반입 경로 모의 설비" in first["assumptions"]
    assert "Pile 길이 모의 값" not in first["assumptions"]


def test_shed_adjacent_other_grade_excluded():
    lots = full("P1", "P2", "P3", "P4", "P5", "P6") + full_sheds(skip=("A3",))
    lots = [l if l["location"] != "A4" else {**l, "grade": "고열량"} for l in lots]
    r = run(cargo(tonnes=20000), lots)
    assert r["options"] == []


def test_mock_t_per_m_assumption():
    r = run(cargo(), full("P3") + full_sheds())
    first = r["options"][0]
    assert first["placements"][0]["target"] == "Pile 1"
    assert "Pile 길이 모의 값" in first["assumptions"]
    assert "모의 m당 톤수: Pile 1" in first["assumptions"]


def test_blocked_without_grade_or_baseline():
    r = run(cargo(grade=None), full("P3"))
    assert r["blocked"] == "고/저 구분 미확인"
    assert r["options"] == [] and r["no_fit"] is None
    r = run(cargo(), [])
    assert r["blocked"] == "기준재고 없음"
    assert r["options"] == [] and r["no_fit"] is None


def test_missing_cv_warns():
    r = run(cargo(cv=None), full("P3"))
    assert r["options"]
    assert all("열량 미확인" in o["warnings"] for o in r["options"])
    r = run(cargo(), full("P3"))
    assert all("열량 미확인" not in o["warnings"] for o in r["options"])


def test_validate_cargo_rejects():
    assert validate_cargo(cargo())["tonnes"] == 6000
    for bad in ({"tonnes": 0}, {"tonnes": 1_000_001}, {"berth": 4}, {"grade": "중"},
                {"destination_yard": 0}, {"source": "other"}, {"tonnes": True}):
        with pytest.raises(ValueError):
            validate_cargo(cargo(**bad))
    assert validate_cargo(cargo(tonnes=1_000_000))["tonnes"] == 1_000_000


def test_at_most_three_options_and_rounding():
    lots = [lot("P1", 0, 100), lot("P2", 0, 100), lot("P3", 0, 100), lot("P4", 0, 100), lot("P5", 0, 100)]
    lots += full("P6") + full_sheds()
    r = run(cargo(tonnes=1234), lots)
    assert MAX_OPTIONS == 3
    assert len(r["options"]) == 3
    assert [o["rank"] for o in r["options"]] == [1, 2, 3]
    for o in r["options"]:
        p = o["placements"][0]
        length = p["to_m"] - p["from_m"]
        assert length * 2 == int(length * 2) and length == 8.5


def test_does_not_mutate_inputs():
    lots = full("P3")
    snapshot = [dict(l) for l in lots]
    run(cargo(), lots)
    assert lots == snapshot


def _mixed_grade_gap_lots():
    lots = [lot("P1", 0, 100, grade="고열량"), lot("P1", 400, 420), lot("P2", 0, 400)]
    return lots + full("P3", "P4", "P5", "P6") + full_sheds()


def test_split_uses_usable_part_of_gap_beside_other_grade():
    r = run(cargo(tonnes=45000), _mixed_grade_gap_lots())
    first = r["options"][0]["placements"]
    assert first == [
        {"yard": 1, "target": "Pile 1", "from_m": 105, "to_m": 400, "tonnes": 44250},
        {"yard": 1, "target": "Pile 2", "from_m": 400, "to_m": 405, "tonnes": 750},
    ]


def test_no_fit_largest_uses_usable_part_of_gap():
    r = run(cargo(tonnes=60000), _mixed_grade_gap_lots())
    assert r["options"] == []
    assert r["no_fit"]["largest"] == {"yard": 1, "target": "Pile 1", "from_m": 105, "to_m": 400, "tonnes": 44250}


def test_usable_part_shrinks_both_sides_of_other_grade():
    lots = [lot("P1", 0, 100, grade="고열량"), lot("P1", 400, 420, grade="고열량")]
    lots += full("P2", "P3", "P4", "P5", "P6") + full_sheds()
    r = run(cargo(tonnes=60000), lots)
    assert r["no_fit"]["largest"] == {"yard": 1, "target": "Pile 1", "from_m": 105, "to_m": 395, "tonnes": 43500}
    r = run(cargo(tonnes=6000), lots)
    assert r["options"][0]["placements"][0] == {"yard": 1, "target": "Pile 1", "from_m": 105, "to_m": 145, "tonnes": 6000}
