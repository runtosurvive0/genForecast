"""기준재고 원탄과 항차 원장의 화물 성분을 맞추는 순수 함수."""

QUALITY_FIELDS = ('gcv_arb', 'tm_ar', 'sulfur_ar')

NO_VOYAGE_NUMBER = '항차번호 없음'
NO_VOYAGE = '원장에 항차 없음'
AMBIGUOUS = '화물을 하나로 특정할 수 없음'
NO_SAME_COAL = '같은 탄종 화물 없음'
NO_ASSAY = '성분 분석 없음'


def match_lot_quality(row, register):
    number = row.get('voyage_number')
    if not number:
        return {'assay': None, 'cargo_no': None, 'reason': NO_VOYAGE_NUMBER}
    voyages = [v for v in register['voyages'] if v.get('voyage_number') == number]
    if not voyages:
        return {'assay': None, 'cargo_no': None, 'reason': NO_VOYAGE}
    if len(voyages) != 1:
        return {'assay': None, 'cargo_no': None, 'reason': AMBIGUOUS}
    cargo = [c for c in register['cargo']
             if c.get('voyage_no') == voyages[0]['voyage_no'] and c.get('coal_name') == row.get('coal_name')]
    if not cargo:
        return {'assay': None, 'cargo_no': None, 'reason': NO_SAME_COAL}
    if len(cargo) != 1:
        return {'assay': None, 'cargo_no': None, 'reason': AMBIGUOUS}
    cargo_no = cargo[0]['cargo_no']
    assay = register['quality_selection'].get(cargo_no)
    if not assay:
        return {'assay': None, 'cargo_no': cargo_no, 'reason': NO_ASSAY}
    return {'assay': assay, 'cargo_no': cargo_no, 'reason': None}


def blend_lots(rows, register):
    """기준재고 원탄 행을 혼탄 계산 입력(lots)으로 바꾼다. 성분은 항차 원장의 분석에서 맞춘다."""
    lots = []
    for row in rows:
        assay = match_lot_quality(row, register)['assay'] or {}
        lots.append({'id': row['source_id'], 'available_t': row['tonnes'], 'gcv_arb': assay.get('gcv_arb'),
                     'tm_ar': assay.get('tm_ar'), 'sulfur_ar': assay.get('sulfur_ar')})
    return lots
