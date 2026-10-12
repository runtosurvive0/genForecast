import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from midterm.auth.store import AccessStore, AccessError
from midterm.web.auth_api import install_access

PASSWORD = 'test password phrase 123'

def test_eight_character_password_for_creation_change_and_recovery(store, client):
    short = 'abcdefgh'
    admin = store.init_admin('admin', 'Admin', short)
    assert store.session(store.login('admin', short))['scope'] == 'full'
    csrf(client)
    for size in (7, 129):
        response = client.post('/api/auth/register', json={
            'username': 'member', 'displayName': 'Member', 'password': 'x' * size})
        assert response.status_code == 422
    response = client.post('/api/auth/register', json={
        'username': 'member', 'displayName': 'Member', 'password': short})
    assert response.status_code == 201
    assert store.session(store.login('member', short))['scope'] == 'pending'
    store.change_password(admin['id'], short, 'ijklmnop')
    store.reset_password('admin', short)
    assert store.session(store.login('admin', short))['scope'] == 'password_change'
    for size in (7, 129):
        with pytest.raises(AccessError):
            store.reset_password('admin', 'x' * size)

@pytest.fixture
def store(tmp_path):
    return AccessStore(tmp_path / 'access.sqlite3')

def test_pending_approval_revokes_session_and_cannot_select_role(store):
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    with pytest.raises(AccessError):
        store.init_admin('other', 'Other', PASSWORD)
    pending = store.register(' Member ', 'Member', PASSWORD)
    assert pending['username'] == 'member' and pending['status'] == 'pending' and pending['role'] == 'user'
    token = store.login('member', PASSWORD)
    assert store.session(token)['scope'] == 'pending'
    active = store.change_user(admin['id'], pending['id'], 'approve', pending['version'])
    assert store.session(token) is None
    token = store.login('member', PASSWORD)
    assert store.session(token)['scope'] == 'full'
    store.change_user(admin['id'], pending['id'], 'suspend', active['version'])
    assert store.session(token) is None
    with pytest.raises(AccessError):
        store.login('member', PASSWORD)
    with pytest.raises(AccessError):
        store.change_user(admin['id'], admin['id'], 'suspend', admin['version'])

def test_workspace_is_private_and_revision_conflicts_preserve_saved_data(store):
    a = store.init_admin('admin', 'Admin', PASSWORD)
    b = store.register('member', 'Member', PASSWORD)
    payload = {'version': 1, 'watchlist': [], 'vessels': [], 'voyages': []}
    original = store.workspace(a['id'])
    assert original['revision'] == 0
    saved = store.save_workspace(a['id'], 0, payload, {'demo-a': 'ais'})
    assert saved['revision'] == 1
    assert store.workspace(b['id'])['revision'] == 0
    with pytest.raises(AccessError):
        store.save_workspace(a['id'], 0, payload, {})
    assert store.workspace(a['id'])['destinations'] == {'demo-a': 'ais'}
    with pytest.raises(AccessError):
        store.save_workspace(a['id'], 1, {**payload, 'watchlist': ['v'] * 201}, {})

def test_password_and_session_expiration_and_secret_storage(store):
    user = store.init_admin('admin', 'Admin', PASSWORD)
    token = store.login('admin', PASSWORD)
    store.change_password(user['id'], PASSWORD, 'new longer password phrase')
    assert store.session(token) is None
    with pytest.raises(AccessError):
        store.login('admin', PASSWORD)
    token = store.login('admin', 'new longer password phrase')
    with store.connect() as db:
        row = db.execute('SELECT * FROM users').fetchone()
        assert row['password_hash'].startswith('$argon2id$')
        assert token not in str(db.execute('SELECT * FROM sessions').fetchall())
        db.execute('UPDATE sessions SET last_seen = last_seen - 3601')
    assert store.session(token) is None
    assert 'password' not in user and 'password_hash' not in user

@pytest.fixture
def client(store):
    app = FastAPI()
    install_access(app, store=store, origins={'http://testserver'}, secure=False)
    @app.get('/api/private')
    def private(): return {'ok': True}
    @app.put('/api/settings')
    def settings(): return {'ok': True}
    @app.post('/api/planning/inputs/upload')
    @app.post('/api/supply/simulation-stock')
    @app.post('/api/supply/port-visits')
    def planning_write(): return {'ok': True}
    @app.get('/api/vessels/tracking/{owner}')
    def tracking(owner: str): return {'ok': True}
    with TestClient(app, headers={'Origin': 'http://testserver'}) as c:
        yield c

def csrf(client):
    r = client.get('/api/auth/csrf')
    assert r.status_code == 200
    client.headers['X-CSRF-Token'] = r.json()['token']

def login(client, username='admin'):
    csrf(client)
    r = client.post('/api/auth/login', json={'username': username, 'password': PASSWORD})
    assert r.status_code == 200, r.text
    client.headers['X-Account-ID'] = r.json()['user']['id']
    csrf(client)
    return r


@pytest.mark.parametrize('path', ['/api/planning/inputs/upload', '/api/supply/simulation-stock', '/api/supply/port-visits'])
def test_planning_and_ledger_writes_require_admin_session_and_csrf(client, store, path):
    assert client.post(path, json={}).status_code == 401
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    login(client, 'member')
    assert client.post(path, json={}).status_code == 403
    login(client)
    assert client.post(path, json={}).status_code == 200
    client.headers.pop('X-CSRF-Token')
    assert client.post(path, json={}).status_code == 403

def test_http_boundary_csrf_approval_owner_and_roles(client, store):
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    assert client.get('/api/private').status_code == 401
    assert client.post('/api/auth/register', json={}).status_code == 403
    csrf(client)
    assert client.post('/api/auth/register', json={'username': 'member', 'displayName': 'M', 'password': PASSWORD, 'role': 'admin'}).status_code == 422
    r = client.post('/api/auth/register', json={'username': 'member', 'displayName': 'M', 'password': PASSWORD})
    assert r.status_code == 201
    pending = r.json()['user']
    r = login(client, 'member')
    assert 'HttpOnly' in r.headers['set-cookie']
    assert client.get('/api/private').status_code == 403
    assert client.get('/api/admin/users').status_code == 403
    login(client)
    assert client.post(f"/api/admin/users/{pending['id']}/actions", json={'action': 'approve', 'version': pending['version']}).status_code == 200
    login(client, 'member')
    assert client.get('/api/private').status_code == 200
    assert client.put('/api/settings', json={}).status_code == 403
    assert client.get(f"/api/vessels/tracking/{admin['id']}").status_code == 403
    assert client.get(f"/api/vessels/tracking/{pending['id']}").status_code == 200
    assert client.post('/api/auth/logout', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/auth/logout').status_code == 200
    assert client.get('/api/private').status_code == 401

def test_register_validation_no_password_echo_and_login_rate_limit(client, store):
    store.init_admin('admin', 'Admin', PASSWORD)
    csrf(client)
    r = client.post('/api/auth/register', json={'username': 'x', 'displayName': 'X', 'password': 'secret-short'})
    assert r.status_code == 422 and 'secret-short' not in r.text
    for _ in range(5):
        assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'incorrect password'}).status_code == 401
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': PASSWORD})
    assert r.status_code == 429 and 'Retry-After' in r.headers

def test_tracking_registration_comes_from_active_account_workspaces(store, tmp_path):
    from midterm.vessels.navigation import TrackStore
    user = store.init_admin('admin', 'Admin', PASSWORD)
    pending = store.register('member', 'Member', PASSWORD)
    vessel = {'id': 'v', 'name': 'TEST', 'mmsi': '440123456', 'imo': '', 'source': 'manual'}
    workspace = {'version': 1, 'watchlist': ['v'], 'vessels': [vessel], 'voyages': []}
    store.save_workspace(user['id'], 0, workspace, {})
    store.save_workspace(pending['id'], 0, workspace, {})
    members = store.tracking_members()
    assert set(members) == {user['id']}
    tracks = TrackStore(tmp_path / 'tracks.sqlite3')
    tracks.sync('anonymous-old', [{'source': 'aisstream', 'mmsi': '440123457'}])
    tracks.reconcile(members)
    assert tracks.active == {('aisstream', '440123456')}
    assert tracks.db.execute('SELECT owner FROM archived_members').fetchone()[0] == 'anonymous-old'
    tracks.close()

def test_recovery_requires_password_change_and_does_not_unsuspend(store):
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    store.reset_password('admin', 'temporary password phrase')
    token = store.login('admin', 'temporary password phrase')
    assert store.session(token)['scope'] == 'password_change'
    store.change_password(admin['id'], 'temporary password phrase', 'replacement password phrase')
    assert store.session(token) is None
    assert store.session(store.login('admin', 'replacement password phrase'))['scope'] == 'full'

def test_workspace_http_rejects_cross_user_data_and_stale_revision(client, store):
    store.init_admin('admin', 'Admin', PASSWORD)
    login(client)
    initial = client.get('/api/me/vessel-workspace').json()
    assert initial['revision'] == 0
    assert client.put('/api/me/vessel-workspace', json={**initial, 'user_id': 'victim'}).status_code == 422
    assert client.put('/api/me/vessel-workspace', json=initial).status_code == 200
    assert client.put('/api/me/vessel-workspace', json=initial).status_code == 409
    assert client.put('/api/me/vessel-workspace', content=b'x' * 1000001).status_code == 413


def test_shared_cookie_switch_cannot_save_old_accounts_workspace(client, store):
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    login(client)
    stale = client.get('/api/me/vessel-workspace').json()
    login(client, 'member')
    # Both revisions are zero. Even a fresh CSRF token must not authorize stale tab A.
    client.headers['X-Account-ID'] = admin['id']
    response = client.put('/api/me/vessel-workspace', json=stale)
    assert response.status_code == 403 and response.json()['code'] == 'account_changed'
    assert client.get('/api/me/vessel-workspace').status_code == 403
    del client.headers['X-Account-ID']
    assert client.put('/api/me/vessel-workspace', json=stale).status_code == 403
    assert store.workspace(member['id'])['revision'] == 0


def test_tracking_union_is_enforced_on_save_and_restore(store):
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    users = [admin]
    for index in range(5):
        user = store.register(f'user{index}', 'Member', PASSWORD)
        users.append(store.change_user(admin['id'], user['id'], 'approve', user['version']))
    def payload(index):
        vessels = [{'id': str(n), 'name': 'TEST', 'mmsi': str(440000000 + n), 'imo': '', 'source': 'manual'}
                   for n in range(index * 200, (index + 1) * 200)]
        return {'version': 1, 'watchlist': [v['id'] for v in vessels], 'vessels': vessels, 'voyages': []}
    for index, user in enumerate(users[:5]):
        store.save_workspace(user['id'], 0, payload(index), {})
    with pytest.raises(AccessError, match='1,000'):
        store.save_workspace(users[5]['id'], 0, payload(5), {})
    assert store.workspace(users[5]['id'])['revision'] == 0
    suspended = store.change_user(admin['id'], users[4]['id'], 'suspend', users[4]['version'])
    store.save_workspace(users[5]['id'], 0, payload(5), {})
    with pytest.raises(AccessError, match='1,000'):
        store.change_user(admin['id'], suspended['id'], 'restore', suspended['version'])
    with store.connect() as db:
        assert db.execute('SELECT status FROM users WHERE id=?', (suspended['id'],)).fetchone()[0] == 'suspended'


def test_reconciliation_starts_restored_collector_and_survives_oversized_legacy_data(store, tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from midterm.vessels.navigation import TrackStore
    from midterm.web import vessels_api
    tracks = TrackStore(tmp_path / 'tracks.sqlite3')
    starts = []
    monkeypatch.setattr(vessels_api, 'tracks', tracks)
    monkeypatch.setattr(vessels_api, 'catalog', SimpleNamespace(start=lambda: starts.append(True)))
    app = SimpleNamespace(state=SimpleNamespace(access_store=store))
    asyncio.run(vessels_api.reconcile_tracking(app))
    assert not starts
    user = store.init_admin('admin', 'Admin', PASSWORD)
    vessel = {'id': 'v', 'name': 'TEST', 'mmsi': '440123456', 'imo': '', 'source': 'manual'}
    store.save_workspace(user['id'], 0, {'version': 1, 'watchlist': ['v'], 'vessels': [vessel], 'voyages': []}, {})
    asyncio.run(vessels_api.reconcile_tracking(app))
    assert starts and len(tracks.active) == 1
    monkeypatch.setattr(store, 'tracking_members', lambda: {'old': [{'source': 'aisstream', 'mmsi': str(440000000+n)} for n in range(1001)]})
    asyncio.run(vessels_api.reconcile_tracking(app))
    assert not tracks.active
    assert app.state.tracking_capacity_error
    tracks.close()

def test_real_app_routes_are_protected_before_handlers_run(store):
    from midterm.web.app import app
    previous = app.state.access_store
    app.state.access_store = store
    try:
        client = TestClient(app, base_url='http://127.0.0.1:8093')
        for route in app.routes:
            path = getattr(route, 'path', '')
            if path.startswith('/api/auth/') or not getattr(route, 'methods', None):
                continue
            import re
            path = re.sub(r'\{[^}]+\}', 'test', path)
            for method in route.methods - {'HEAD', 'OPTIONS'}:
                assert client.request(method, path).status_code == 401, (method, path)
    finally:
        app.state.access_store = previous
