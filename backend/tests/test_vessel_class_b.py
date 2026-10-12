"""AISstream Class B regressions using message 18/19/24 wire shapes."""
import asyncio
import json

import pytest

from midterm.vessels.ais import AisCatalog
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.fleet_map import fleet_map

T0 = '2026-10-12T00:00:00Z'
T1 = '2026-10-12T00:01:00Z'
T2 = '2026-10-12T00:02:00Z'


def payload(kind, report, name=''):
    return {'MessageType': kind, 'MetaData': {'MMSI': 440123456, 'ShipName': name},
            'Message': {kind: {'UserID': 440123456, 'Valid': True, **report}}}


def static_part(part, name='LOCAL VESSEL', ship_type=30):
    return payload('StaticDataReport', {'PartNumber': part,
        'ReportA': {'Valid': not part, 'Name': name},
        'ReportB': {'Valid': bool(part), 'ShipType': ship_type}})


@pytest.mark.parametrize('kind', ['StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
def test_class_b_position_reaches_persistent_harbour_map(tmp_path, kind):
    async def run():
        db = DiscoveryStore(tmp_path / 'class-b.sqlite3')
        c = AisCatalog(api_key='', store=db)
        c.ingest(payload(kind, {'Latitude': 36.98, 'Longitude': 126.45, 'Sog': 0,
                               'Cog': 90, 'Name': 'LOCAL VESSEL', 'Type': 30}), T0)
        await c.flush()
        result = fleet_map(db, 126.2, 126.8, 36.7, 37.2, 14, T1)
        assert result['visibleCount'] == 1
        assert result['features'][0]['geometry']['coordinates'] == [126.45, 36.98]
        vessel = db.snapshot(T1)['vessels'][0]
        assert vessel['ais']['navStatus'] is None
        assert vessel['ais']['destination'] == ''
        assert vessel['ais']['position']['sogKn'] == 0
        if kind == 'ExtendedClassBPositionReport':
            assert vessel['name'] == 'LOCAL VESSEL'
            assert vessel['ais']['shipType'] == 30
        db.close()
    asyncio.run(run())


def test_class_b_static_parts_merge_out_of_order_and_survive_restart(tmp_path):
    async def run():
        db = DiscoveryStore(tmp_path / 'parts.sqlite3')
        c = AisCatalog(api_key='', store=db)
        c.ingest(static_part(False), T2)  # Name arrives before an older type report.
        c.ingest(static_part(True), T0)
        assert c.snapshot()['vessels'][0]['ais']['shipType'] == 30
        await c.flush()
        c = AisCatalog(api_key='', store=db)
        await c.restore()
        c.ingest(static_part(True, ship_type=52), T1)
        c.ingest(static_part(False, name='OLD NAME'), T0)
        v = c.snapshot()['vessels'][0]
        assert v['name'] == 'LOCAL VESSEL'
        assert v['ais']['shipType'] == 52
        assert v['ais']['position'] is None
        assert v['ais']['staticObservedAt'] == T2
        db.close()
    asyncio.run(run())


@pytest.mark.parametrize('part', [False, True])
def test_class_b_ignores_inactive_or_invalid_static_part(part):
    c = AisCatalog(api_key='')
    packet = static_part(part)
    packet['Message']['StaticDataReport']['ReportA' if not part else 'ReportB']['Valid'] = False
    c.ingest(packet, T0)
    assert c.snapshot()['vessels'] == []


def test_class_b_preserves_voyage_and_does_not_refresh_position_from_static_metadata():
    c = AisCatalog(api_key='')
    c.ingest(payload('ShipStaticData', {'Name': 'CARGO', 'Type': 70, 'Destination': 'KRPUS', 'ImoNumber': 1234567}), T0)
    c.ingest(payload('PositionReport', {'Latitude': 36.9, 'Longitude': 126.4, 'Sog': 12, 'NavigationalStatus': 0}), T0)
    c.ingest(payload('StandardClassBPositionReport', {'Latitude': 36.98, 'Longitude': 126.45, 'Sog': 102.3, 'Cog': 360}, 'OLD METADATA'), T1)
    c.ingest(static_part(True, ship_type=52), T2)
    v = c.snapshot()['vessels'][0]
    assert v['ais']['position'] == {'latitude': 36.98, 'longitude': 126.45, 'sogKn': None, 'cogDeg': None, 'observedAt': T1}
    assert v['ais']['shipType'] == 52
    assert v['name'] == 'CARGO'
    assert v['imo'] == '1234567'
    assert v['ais']['destination'] == 'KRPUS'
    assert v['ais']['destinationObservedAt'] == T0
    assert v['ais']['navStatus'] == 0


@pytest.mark.parametrize('kind', ['StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
def test_class_b_rejects_invalid_and_older_positions(kind):
    c = AisCatalog(api_key='')
    c.ingest(payload(kind, {'Latitude': 91, 'Longitude': 181}), T0)
    assert c.snapshot()['vessels'] == []
    c.ingest(payload(kind, {'Latitude': 36.98, 'Longitude': 126.45}), T2)
    c.ingest(payload(kind, {'Latitude': 35, 'Longitude': 125}), T1)
    assert c.snapshot()['vessels'][0]['ais']['position']['latitude'] == 36.98


@pytest.mark.parametrize('kind', ['StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
def test_live_subscription_requests_class_b_and_delivers_it_to_catalog(monkeypatch, kind):
    import websockets.asyncio.client
    class Socket:
        def __init__(self):
            self.types = []
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def send(self, data): self.types = json.loads(data)['FilterMessageTypes']
        def __aiter__(self): return self.frames()
        async def frames(self):
            packets = [static_part(False), static_part(True),
                       payload(kind, {'Latitude': 36.98, 'Longitude': 126.45})]
            for packet in packets:
                if packet['MessageType'] in self.types:
                    yield json.dumps(packet)
            raise asyncio.CancelledError()
    socket = Socket()
    monkeypatch.setattr(websockets.asyncio.client, 'connect', lambda *a, **k: socket)
    async def run():
        c = AisCatalog(api_key='test-only')
        with pytest.raises(asyncio.CancelledError):
            await c._receive()
        v = c.snapshot()['vessels'][0]
        assert v['name'] == 'LOCAL VESSEL'
        assert v['ais']['shipType'] == 30
        assert v['ais']['position']['latitude'] == 36.98
    asyncio.run(run())
