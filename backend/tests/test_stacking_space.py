from midterm.stacking.layout import load_layout
from midterm.stacking.space import grade_of, yard_space


def lot(location, start=None, end=None, tonnes=1000, **extra):
    base = {"location": location, "coal_name": "탄", "tonnes": tonnes, "voyage_number": "V1",
            "grade": "고열량", "age_days": 5, "temperature_c": 20, "start_m": start, "end_m": end}
    base.update(extra)
    return base


def space(lots):
    return yard_space(lots, load_layout())


def test_gaps_between_and_at_ends():
    s = space([lot("P1", 30, 110), lot("P1", 230, 300)])
    assert s["piles"]["P1"]["gaps"] == [(0, 30), (110, 230), (300, 420)]
    assert s["piles"]["P1"]["yard"] == 1 and s["piles"]["P1"]["length_m"] == 420


def test_gap_shorter_than_min_dropped():
    s = space([lot("P1", 0, 100), lot("P1", 103, 420)])
    assert s["piles"]["P1"]["gaps"] == []


def test_overlap_and_out_of_range_intervals():
    s = space([lot("P1", 100, 200), lot("P1", 150, 250), lot("P1", 400, 450)])
    assert s["piles"]["P1"]["gaps"] == [(0, 100), (250, 400)]


def test_t_per_m_from_lots():
    s = space([lot("P1", 330, 420, tonnes=17068), lot("P1", 230, 280, tonnes=6085)])
    p = s["piles"]["P1"]
    assert p["t_per_m"] == (17068 + 6085) / (90 + 50)
    assert p["t_per_m_mock"] is False
    assert len(p["lots"]) == 2 and p["lots"][0]["grade"] == "고"


def test_empty_pile_uses_mock_t_per_m():
    p = space([])["piles"]["P5"]
    assert p["t_per_m"] == 150 and p["t_per_m_mock"] is True
    assert p["gaps"] == [(0, 720)] and p["yard"] == 2 and p["unplaced"] is False


def test_unplaced_lot_marks_pile():
    s = space([lot("P6")])
    assert s["piles"]["P6"]["unplaced"] is True
    assert s["piles"]["P6"]["gaps"] == [(0, 720)]
    assert s["piles"]["P7"]["unplaced"] is False


def test_zero_tonne_lot_does_not_occupy():
    s = space([lot("P2", 0, 420, tonnes=0)])
    assert s["piles"]["P2"]["gaps"] == [(0, 420)]
    assert s["piles"]["P2"]["lots"] == []


def test_shed_cells():
    s = space([lot("A1"), lot("A2", grade="저열량")])
    a, b = s["sheds"]["A"]["cells"], s["sheds"]["B"]["cells"]
    assert a[1]["tonnes"] == 1000 and a[1]["grade"] == "고" and a[2]["grade"] == "저"
    assert a[3] is None
    assert sorted(a) == list(range(1, 11))
    assert all(v is None for v in b.values()) and sorted(b) == list(range(1, 11))


def test_grade_of():
    assert grade_of("고열량") == "고"
    assert grade_of("저열") == "저"
    assert grade_of(None) is None
    assert grade_of("") is None
