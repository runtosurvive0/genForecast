from midterm.baseline_quality import QUALITY_FIELDS, match_lot_quality


def register(cargo=None, voyages=None, assays=None):
    return {
        'voyages': voyages if voyages is not None else [{'voyage_no': 'V1', 'voyage_number': 'KV-1'}],
        'cargo': cargo if cargo is not None else [{'cargo_no': 'C1', 'voyage_no': 'V1', 'coal_name': 'A탄'}],
        'quality_selection': assays if assays is not None else {
            'C1': {'gcv_arb': 4200, 'tm_ar': 10, 'sulfur_ar': 0.5, 'data_origin': 'dummy', 'dummy_fields': ['gcv_arb']}},
    }


ROW = {'voyage_number': 'KV-1', 'coal_name': 'A탄'}


def test_match_single_cargo():
    out = match_lot_quality(ROW, register())
    assert out['assay']['gcv_arb'] == 4200
    assert out['assay']['data_origin'] == 'dummy'
    assert out['cargo_no'] == 'C1'
    assert out['reason'] is None
    assert QUALITY_FIELDS == ('gcv_arb', 'tm_ar', 'sulfur_ar')


def test_no_voyage_number():
    out = match_lot_quality({**ROW, 'voyage_number': ''}, register())
    assert out == {'assay': None, 'cargo_no': None, 'reason': '항차번호 없음'}


def test_voyage_not_in_registry():
    out = match_lot_quality({**ROW, 'voyage_number': 'KV-9'}, register())
    assert out['reason'] == '원장에 항차 없음'
    assert out['assay'] is None


def test_ambiguous_cargo_reason():
    cargo = [{'cargo_no': 'C1', 'voyage_no': 'V1', 'coal_name': 'A탄'},
             {'cargo_no': 'C2', 'voyage_no': 'V1', 'coal_name': 'A탄'}]
    out = match_lot_quality(ROW, register(cargo=cargo))
    assert out['reason'] == '화물을 하나로 특정할 수 없음'
    assert out['assay'] is None


def test_duplicate_voyage_number_is_ambiguous():
    voyages = [{'voyage_no': 'V1', 'voyage_number': 'KV-1'}, {'voyage_no': 'V2', 'voyage_number': 'KV-1'}]
    out = match_lot_quality(ROW, register(voyages=voyages))
    assert out['reason'] == '화물을 하나로 특정할 수 없음'


def test_no_assay():
    out = match_lot_quality(ROW, register(assays={}))
    assert out['reason'] == '성분 분석 없음'
    assert out['assay'] is None
    assert out['cargo_no'] == 'C1'
