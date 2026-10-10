import pytest

from midterm.vessels.destinations import resolve_destination, port_coordinates
from midterm.vessels.navigation import SeaRouter


@pytest.mark.parametrize('raw,code', [('KR PUS', 'KRPUS'), ('SGSIN', 'SGSIN'),
                                     ('SINGAPORE', 'SGSIN'), ('BUSAN', 'KRPUS'),
                                     ('CNSHA > KR PUS', 'KRPUS')])
def test_exact_destination_codes_and_names(raw, code):
    result = resolve_destination(raw)
    assert result['status'] == 'resolved'
    assert result['destinationId'] == f'port:{code}'
    assert result['raw'] == raw
    assert len(port_coordinates(result['destinationId'])) == 2


@pytest.mark.parametrize('raw', ['', 'FOR ORDERS', 'BUSAN OR ULSAN', 'NOT KRPUS', 'KR', 'KRPUS / SGSIN'])
def test_unresolved_destination_never_guesses_a_plant(raw):
    result = resolve_destination(raw)
    assert result['status'] in ('missing', 'unresolved', 'ambiguous')
    assert 'destinationId' not in result


def test_duplicate_names_are_ambiguous(monkeypatch):
    from midterm.vessels import destinations
    monkeypatch.setattr(destinations, 'port_catalog', lambda: {
        'AAONE': {'name': 'Same Port'}, 'BBTWO': {'name': 'Same Port'}})
    assert resolve_destination('Same Port')['status'] == 'ambiguous'


def test_global_destination_routes_and_rejects_unknown():
    route = SeaRouter().route(125, 35, 'port:SGSIN')
    assert route['destinationId'] == 'port:SGSIN'
    assert route['distanceNm'] > 1000
    with pytest.raises(ValueError):
        SeaRouter().route(125, 35, 'port:XXXXX')
