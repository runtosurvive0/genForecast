import asyncio
import copy
from datetime import datetime, timezone, timedelta

import pytest

from midterm.vessels.ais import AisCatalog
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.openwaters import OpenWatersReceiver

NOW = datetime.now(timezone.utc) - timedelta(seconds=10)


def event(kind='PositionReport', seconds=0, **fields):
    report = {'UserID': 440123456, 'Valid': True, 'Latitude': 37.0,
              'Longitude': 126.75, 'Sog': 12, 'Cog': 90, 'NavigationalStatus': 0}
    report.update(fields)
    return {'type': 'event', 'msg_type': kind, 'mmsi': 440123456,
            'time': (NOW + timedelta(seconds=seconds)).isoformat(),
            'source': 'aishub', 'message': report, 'synthesized': False}


def receive(catalog, message):
    receiver = OpenWatersReceiver(catalog.ingest, enabled=True)
    return receiver.handle(message)


def test_two_feeds_share_identity_and_newest_position_wins():
    c = AisCatalog(api_key='')
    msg = event()
    assert receive(c, msg)
    row = c.snapshot()['vessels'][0]
    assert row['id'] == 'ais-440123456'
    assert row['ais']['position']['feed'] == 'openwaters'
    assert row['ais']['position']['upstream'] == 'aishub'
    # Original feed arriving late must not move the ship backwards.
    payload = {'MessageType': 'PositionReport', 'MetaData': {'MMSI': 440123456,
               'time_utc': (NOW - timedelta(seconds=1)).isoformat()},
               'Message': {'PositionReport': {**msg['message'], 'Latitude': 35}}}
    c.ingest(payload, datetime.now(timezone.utc).isoformat())
    assert row['ais']['position']['latitude'] == 37
    payload['MetaData']['time_utc'] = (NOW + timedelta(seconds=1)).isoformat()
    c.ingest(payload, datetime.now(timezone.utc).isoformat())
    assert len(c.snapshot()['vessels']) == 1
    assert row['ais']['position']['latitude'] == 35
    assert row['ais']['position'].get('feed', 'aisstream') == 'aisstream'


def test_static_message_never_refreshes_position_and_fields_survive():
    c = AisCatalog(api_key='')
    receive(c, event())
    before = copy.deepcopy(c.snapshot()['vessels'][0]['ais']['position'])
    receive(c, event('ShipStaticData', seconds=1, Name='LOCAL BULK', Type=70,
                     Destination='KR PTK', ImoNumber=1234567))
    row = c.snapshot()['vessels'][0]
    assert row['name'] == 'LOCAL BULK'
    assert row['ais']['destination'] == 'KR PTK'
    assert row['ais']['position'] == before


@pytest.mark.parametrize('patch', [
    {'synthesized': True}, {'time': None}, {'time': 'invalid'},
    {'time': (NOW + timedelta(days=1)).isoformat()},
    {'mmsi': 0}, {'message': []}, {'msg_type': 'AidsToNavigationReport'},
    {'message': {'UserID': 440123456, 'Latitude': 91, 'Longitude': 181}},
    {'message': {'UserID': 440999999, 'Latitude': 37, 'Longitude': 126.75}},
    {'message': {'UserID': 440123456, 'Latitude': 50, 'Longitude': 1}},
])
def test_invalid_or_reconstructed_events_are_not_observations(patch):
    c = AisCatalog(api_key='')
    msg = event()
    msg.update(patch)
    assert not receive(c, msg)
    assert not c.snapshot()['vessels']


def test_sentinels_and_class_b_supported():
    c = AisCatalog(api_key='')
    receive(c, event('StandardClassBPositionReport', Sog=102.3, Cog=360))
    p = c.snapshot()['vessels'][0]['ais']['position']
    assert p['sogKn'] is None and p['cogDeg'] is None


def test_aishub_json_reencoding_is_not_a_simulated_position():
    c = AisCatalog(api_key='')
    msg = event()
    msg.update(synthesized=True, id='9c383bdf4e5ee09db1d6e726f1cc573e',
               nmea=['!AIVDM,1,1,,A,16SaBp8P00a4bNvE8eJC4?vB0000,0*68'])
    assert receive(c, msg)
    p = c.snapshot()['vessels'][0]['ais']['position']
    assert p['reencoded'] is True
    assert p['observedAt'] == NOW.isoformat().replace('+00:00', 'Z')
    msg['source'] = 'mmsi:440123456'  # Not an upstream AIS JSON feed.
    assert not receive(c, msg)


def test_opt_in_and_bounded_configuration(monkeypatch):
    monkeypatch.delenv('OPENWATERS_ENABLED', raising=False)
    r = OpenWatersReceiver(lambda *a, **kw: None)
    assert r.status == 'disabled'
    monkeypatch.setenv('OPENWATERS_ENABLED', '1')
    monkeypatch.setenv('OPENWATERS_BOUNDING_BOXES', '[[90,180,-90,-180]]')
    r = OpenWatersReceiver(lambda *a, **kw: None)
    assert r.status == 'configuration_error'


def test_persisted_provenance_and_map_survive_restart(tmp_path):
    from midterm.vessels.fleet_map import fleet_map
    async def run():
        db = DiscoveryStore(tmp_path / 'ships.sqlite3')
        c = AisCatalog(api_key='', store=db)
        receive(c, event())
        await c.flush()
        restored = AisCatalog(api_key='', store=db)
        await restored.restore()
        assert restored.snapshot()['vessels'][0]['ais']['position']['feed'] == 'openwaters'
        result = fleet_map(db, 126.4, 126.9, 36.8, 37.2, 14, datetime.now(timezone.utc).isoformat())
        assert result['visibleCount'] == 1
        db.close()
    asyncio.run(run())


def test_receiver_is_started_without_browser_and_stopped(monkeypatch):
    monkeypatch.setenv('OPENWATERS_ENABLED', '1')
    started = []
    async def fake(self):
        started.append(True)
        self.handle(event())
        self.status = 'receiving'
        await asyncio.Event().wait()
    monkeypatch.setattr(OpenWatersReceiver, '_receive', fake)
    async def run():
        c = AisCatalog(api_key='')
        c.start()
        c.start()
        await asyncio.sleep(0)
        assert len(started) == 1
        assert c.snapshot()['status'] == 'receiving'
        assert c.snapshot()['feeds']['openwaters']['status'] == 'receiving'
        await c.stop()
        assert c.openwaters._task is None
    asyncio.run(run())


def test_registered_watchlist_keeps_openwaters_observations(tmp_path):
    from midterm.vessels.navigation import TrackStore
    from midterm.auth.workspace import checked_workspace
    tracks = TrackStore(tmp_path / 'tracks.sqlite3')
    tracks.sync('test-owner', [{'source': 'aisstream', 'mmsi': '440123456'}])
    c = AisCatalog(api_key='', on_observation=tracks.record)
    receive(c, event())
    vessel = tracks.latest('test-owner')[0]
    # Match the frontend's normalized DTO, not backend-only clocks.
    a = vessel['ais']
    vessel['ais'] = {k: a[k] for k in ('updatedAt', 'shipType', 'navStatus', 'destination', 'position')}
    result, _ = checked_workspace({'version': 1, 'watchlist': [vessel['id']],
                                    'vessels': [vessel], 'voyages': []}, {})
    assert result['vessels'][0]['ais']['position']['feed'] == 'openwaters'
    tracks.flush()
    assert tracks.history('test-owner', 'aisstream', '440123456', 24)['pointCount'] == 1
    tracks.close()


def test_provider_failure_is_separate_and_does_not_disclose_token(monkeypatch):
    import json
    monkeypatch.setenv('OPENWATERS_ENABLED', '1')
    monkeypatch.setenv('OPENWATERS_API_TOKEN', 'private-test-token')
    c = AisCatalog(api_key='private-original-key')
    c.status = 'receiving'
    c.openwaters.status = 'provider_error'
    result = c.snapshot()
    assert result['status'] == 'receiving'
    assert result['feeds']['openwaters']['status'] == 'provider_error'
    assert 'private-' not in json.dumps(result)
