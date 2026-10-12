import json
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.fleet_map import fleet_map, vessel_detail

NOW = '2026-10-12T00:00:00Z'


def record(mmsi, lon, lat, observed=NOW):
    v = dict(id='ais-'+mmsi, name='SHIP '+mmsi, mmsi=mmsi, imo='', source='aisstream',
             ais=dict(updatedAt=NOW, position=dict(longitude=lon, latitude=lat, observedAt=observed, sogKn=12, cogDeg=90)))
    return (json.dumps(v), 1, None, None)


def test_viewport_wraps_dateline_excludes_missing_positions_and_preserves_staleness(tmp_path):
    store = DiscoveryStore(tmp_path/'map.sqlite3')
    store.save({'440000001': record('440000001', 179, 35), '440000002': record('440000002', -179, 35),
                '440000003': record('440000003', 125, 35),
                '440000004': record('440000004', 179, 34, '2026-10-01T00:00:00Z')}, NOW)
    result = fleet_map(store, 170, -170, 30, 40, 8, NOW)
    assert result['visibleCount'] == 3
    assert len(result['features']) == 3
    assert sum(f['properties']['fresh'] for f in result['features']) == 2
    assert vessel_detail(store, '440000003', NOW)['mmsi'] == '440000003'
    assert vessel_detail(store, '440000099', NOW) is None
    store.close()


def test_full_catalog_is_aggregated_without_dropping_ships(tmp_path):
    store = DiscoveryStore(tmp_path/'map.sqlite3')
    store.save({str(440000000+i): record(str(440000000+i), (i*13.1)%358-179, (i*7.1)%160-80) for i in range(40000)}, NOW)
    result = fleet_map(store, -180, 180, -85, 85, 4, NOW)
    assert result['visibleCount'] == 40000
    assert len(result['features']) <= 1200
    assert sum(f['properties']['count'] for f in result['features']) == 40000
    assert len(json.dumps(result)) < 500000
    store.close()


def test_coincident_ships_are_individually_selectable_at_harbour_zoom(tmp_path):
    store = DiscoveryStore(tmp_path/'map.sqlite3')
    store.save({'440000001': record('440000001', 125, 35), '440000002': record('440000002', 125, 35)}, NOW)
    assert fleet_map(store, 120, 130, 30, 40, 5, NOW)['features'][0]['properties']['count'] == 2
    result = fleet_map(store, 120, 130, 30, 40, 18, NOW)
    assert {f['properties']['mmsi'] for f in result['features']} == {'440000001', '440000002'}
    store.close()


def test_map_api_requires_login_validates_bounds_and_returns_single_vessel(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from midterm.auth.store import AccessStore
    from midterm.web.auth_api import install_access
    from midterm.web import vessels_api as api
    db = DiscoveryStore(tmp_path/'map.sqlite3')
    db.save({'440000001': record('440000001', 125, 35)}, NOW)
    monkeypatch.setattr(api, 'catalog', SimpleNamespace(store=db))
    monkeypatch.setattr(api, 'utc_now', lambda: NOW)
    access = AccessStore(tmp_path/'auth.sqlite3')
    access.init_admin('admin', 'Admin', 'test-only-password')
    app = FastAPI()
    app.include_router(api.router)
    install_access(app, store=access, origins={'http://testserver'}, secure=False)
    client = TestClient(app)  # No operational AIS lifespan during this isolated HTTP test.
    url = '/api/vessels/map?west=120&east=130&south=30&north=40&zoom=8'
    assert client.get(url).status_code == 401
    assert client.get('/api/vessels/map/440000001').status_code == 401
    client.cookies.set('gf_session', access.login('admin', 'test-only-password'))
    assert client.get(url).json()['visibleCount'] == 1
    assert client.get(url.replace('south=30', 'south=50')).status_code == 422
    assert client.get(url.replace('west=120', 'west=nan')).status_code == 422
    assert client.get('/api/vessels/map/440000001').json()['name'] == 'SHIP 440000001'
    assert client.get('/api/vessels/map/440000099').status_code == 404
    assert client.get('/api/vessels/map/invalid').status_code == 422
    client.close()
    db.close()
