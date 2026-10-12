import asyncio
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Response
from midterm.auth.store import AccessStore
from midterm.vessels.ais import AisCatalog


NOW = datetime.now(timezone.utc).isoformat()


def message(mmsi=440123456, destination=None, observed=NOW):
    kind = 'PositionReport' if destination is None else 'ShipStaticData'
    data = {'Latitude': 35, 'Longitude': 129, 'Sog': 12, 'Cog': 90} if destination is None else {'Destination': destination, 'Type': 70, 'ImoNumber': 9459101}
    return {'MessageType': kind, 'MetaData': {'MMSI': mmsi, 'ShipName': 'TEST BULK', 'time_utc': observed}, 'Message': {kind: data}}


def test_committed_catalog_survives_restart_and_preserves_observation_times(tmp_path):
    from midterm.vessels.discovery_store import DiscoveryStore
    async def run():
        db = DiscoveryStore(tmp_path / 'discovery.sqlite3')
        catalog = AisCatalog(api_key='', store=db)
        catalog.ingest(message(), NOW)
        catalog.ingest(message(destination='KR PUS'), NOW)
        assert db.snapshot(NOW)['vessels'] == []
        await catalog.flush()
        await catalog.stop()
        db.close()
        restored_db = DiscoveryStore(tmp_path / 'discovery.sqlite3')
        restored = AisCatalog(api_key='', store=restored_db)
        await restored.restore()
        snap = restored_db.snapshot(NOW)
        assert len(snap['vessels']) == 1
        assert snap['vessels'][0]['ais']['position']['observedAt'] == datetime.fromisoformat(NOW).isoformat().replace('+00:00', 'Z')
        assert snap['koreaCandidates']['entries'][0]['portCode'] == 'KRPUS'
        assert snap['lastReceivedAt'] == NOW
        restored.ingest(message(destination='SGSIN'), NOW)
        await restored.flush()
        assert not restored_db.snapshot(NOW)['koreaCandidates']['entries']
        assert restored_db.snapshot(NOW)['vessels'][0]['ais']['position'] == snap['vessels'][0]['ais']['position']
        await restored.stop()
        restored_db.close()
    asyncio.run(run())


def test_bounded_eviction_and_expired_candidate_do_not_return_after_restart(tmp_path, monkeypatch):
    from midterm.vessels.discovery_store import DiscoveryStore
    import midterm.vessels.ais as module
    monkeypatch.setattr(module, 'MAX_VESSELS', 2)
    async def run():
        db = DiscoveryStore(tmp_path / 'discovery.sqlite3')
        c = AisCatalog(api_key='', store=db)
        c.ingest(message(440123456, 'KR PUS'), NOW)
        for mmsi in (440123457, 440123458, 440123459):
            c.ingest(message(mmsi), NOW)
        await c.flush()
        s = db.snapshot(NOW)
        assert {v['mmsi'] for v in s['vessels']} == {'440123458', '440123459'}
        assert len(s['koreaCandidates']['entries']) == 1
        future = (datetime.fromisoformat(NOW) + timedelta(hours=73)).isoformat()
        c._prune_candidates(future)
        await c.flush()
        assert not db.snapshot(future)['koreaCandidates']['entries']
        restored = AisCatalog(api_key='', store=db)
        await restored.restore()
        assert {v['mmsi'] for v in restored.known_vessels()} == {'440123458', '440123459'}
        db.close()
    asyncio.run(run())


def test_failed_flush_retries_latest_record(tmp_path, monkeypatch):
    from midterm.vessels.discovery_store import DiscoveryStore
    async def run():
        db = DiscoveryStore(tmp_path / 'discovery.sqlite3')
        c = AisCatalog(api_key='', store=db)
        c.ingest(message(), NOW)
        real_save = db.save
        def fail(*args):
            raise OSError('disk unavailable')
        monkeypatch.setattr(db, 'save', fail)
        import pytest
        with pytest.raises(OSError):
            await c.flush()
        c.ingest(message(destination='KR PUS'), NOW)
        monkeypatch.setattr(db, 'save', real_save)
        await c.flush()
        assert db.snapshot(NOW)['vessels'][0]['ais']['destination'] == 'KR PUS'
        db.close()
    asyncio.run(run())


def test_lifespan_collects_without_accounts_or_requests_and_catalog_reads_db(tmp_path, monkeypatch):
    from midterm.web import vessels_api as api
    monkeypatch.setenv('AIS_TRACK_DB', str(tmp_path / 'tracks.sqlite3'))
    monkeypatch.setenv('AIS_DISCOVERY_DB', str(tmp_path / 'discovery.sqlite3'))
    monkeypatch.setenv('AISSTREAM_API_KEY', 'test-only-not-a-real-key')
    access = AccessStore(tmp_path / 'access.sqlite3')
    app = FastAPI()
    app.state.access_store = access
    received = asyncio.Event()
    async def fake_receive(self):
        self.ingest(message(), NOW)
        received.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(AisCatalog, '_receive', fake_receive)
    async def run():
        async with api.lifespan(app):
            await asyncio.sleep(0)
            assert received.is_set(), 'Collection must start before any browser request'
            await api.catalog.flush()
            def forbidden_start():
                raise AssertionError('HTTP query must not start collection')
            monkeypatch.setattr(api.catalog, 'start', forbidden_start)
            snap = await api.vessel_catalog(Response())
            assert len(snap['vessels']) == 1
        monkeypatch.setenv('AISSTREAM_API_KEY', '')
        async with api.lifespan(app):
            snap = await api.vessel_catalog(Response())
            assert len(snap['vessels']) == 1
            assert snap['status'] == 'not_configured'
    asyncio.run(run())
