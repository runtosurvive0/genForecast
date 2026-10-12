"""SQLite accounts and revocable opaque sessions, isolated from operational data."""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import json
import re
import secrets
import sqlite3
import time
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError

HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))


class AccessError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(message)
        self.status, self.code, self.retry_after = status, code, retry_after


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def identity(username, name=None):
    username = username.strip().lower()
    if not re.fullmatch(r'[a-z0-9._-]{3,32}', username):
        raise AccessError(422, 'invalid_username', '아이디는 영문 소문자·숫자·점·밑줄·하이픈 3~32자입니다.')
    if name is not None and not 1 <= len(name.strip()) <= 50:
        raise AccessError(422, 'invalid_name', '이름은 1~50자로 입력해 주세요.')
    return username


def password_hash(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise AccessError(422, 'invalid_password', '비밀번호는 공백을 포함해 8~128자로 입력해 주세요.')
    return HASHER.hash(password)


def verify(encoded, password):
    try:
        return HASHER.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def public_user(row):
    return {k: row[k] for k in ('id', 'username', 'displayName', 'role', 'status', 'version', 'createdAt', 'reviewedAt', 'mustChangePassword')}


class AccessStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError('Unsupported access DB version; keep the database and restore a compatible server.')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users(
                  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, displayName TEXT NOT NULL,
                  password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
                  version INTEGER NOT NULL DEFAULT 1, mustChangePassword INTEGER NOT NULL DEFAULT 0,
                  createdAt REAL NOT NULL, reviewedAt REAL);
                CREATE TABLE IF NOT EXISTS sessions(
                  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                  version INTEGER NOT NULL, scope TEXT NOT NULL, created REAL NOT NULL,
                  last_seen REAL NOT NULL, expires REAL NOT NULL, reauthenticated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS csrf_tokens(token_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS limits(key TEXT NOT NULL, at REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS limits_key ON limits(key, at);
                CREATE TABLE IF NOT EXISTS workspaces(user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, destinations TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit(actor TEXT, action TEXT NOT NULL, target TEXT, at REAL NOT NULL);
                PRAGMA user_version=1;
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def _audit(self, db, actor, action, target):
        db.execute('INSERT INTO audit VALUES(?,?,?,?)', (actor, action, target, time.time()))
        db.execute('DELETE FROM audit WHERE at < ?', (time.time() - 90 * 86400,))

    def initialized(self):
        with self.connect() as db:
            return bool(db.execute("SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone())

    def init_admin(self, username, name, password):
        username = identity(username, name)
        encoded = password_hash(password)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
                raise AccessError(409, 'already_initialized', '관리자가 이미 설정되어 있습니다.')
            return self._insert_user(db, username, name, encoded, 'admin', 'active')

    def _insert_user(self, db, username, name, encoded, role, status):
        uid = str(uuid4())
        try:
            db.execute('INSERT INTO users(id,username,displayName,password_hash,role,status,createdAt) VALUES(?,?,?,?,?,?,?)',
                       (uid, username, name.strip(), encoded, role, status, time.time()))
        except sqlite3.IntegrityError:
            raise AccessError(409, 'username_unavailable', '사용할 수 없는 아이디입니다.') from None
        self._audit(db, uid if role == 'admin' else None, 'initialize' if role == 'admin' else 'register', uid)
        return public_user(db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone())

    def register(self, username, name, password):
        username = identity(username, name)
        encoded = password_hash(password)
        with self.connect() as db:
            return self._insert_user(db, username, name, encoded, 'user', 'pending')

    def rate_limit(self, key, maximum, period):
        now = time.time()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM limits WHERE at < ?', (now - 3600,))
            hits = db.execute('SELECT at FROM limits WHERE key=? AND at>? ORDER BY at', (key, now - period)).fetchall()
            if len(hits) >= maximum:
                raise AccessError(429, 'rate_limited', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', max(1, int(hits[0]['at'] + period - now) + 1))
            db.execute('INSERT INTO limits VALUES(?,?)', (key, now))

    def login(self, username, password):
        username = username.strip().lower()
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
            if not verify(row['password_hash'] if row else DUMMY_HASH, password):
                raise AccessError(401, 'invalid_credentials', '아이디 또는 비밀번호를 확인해 주세요.')
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
            if current['version'] != row['version']:
                raise AccessError(409, 'account_changed', '계정 상태가 변경되었습니다. 다시 로그인해 주세요.')
            if row['status'] in ('rejected', 'suspended'):
                raise AccessError(403, row['status'], '가입이 거절되었거나 이용이 정지된 계정입니다. 관리자에게 문의해 주세요.')
            if HASHER.check_needs_rehash(row['password_hash']):
                db.execute('UPDATE users SET password_hash=? WHERE id=?', (HASHER.hash(password), row['id']))
            token, now = secrets.token_urlsafe(32), time.time()
            scope = 'pending' if row['status'] == 'pending' else 'password_change' if row['mustChangePassword'] else 'full'
            db.execute('DELETE FROM sessions WHERE expires<? OR last_seen<?', (now, now - 3600))
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)',
                       (digest(token), row['id'], row['version'], scope, now, now, now + (43200 if scope == 'full' else 1800), now))
            db.execute('DELETE FROM limits WHERE key=?', ('login-user:' + digest(username),))
            self._audit(db, row['id'], 'login', row['id'])
            return token

    def session(self, token, touch=True):
        if not token or len(token) > 128:
            return None
        now = time.time()
        with self.connect() as db:
            s = db.execute('SELECT * FROM sessions WHERE token_hash=?', (digest(token),)).fetchone()
            if not s:
                return None
            u = db.execute('SELECT * FROM users WHERE id=?', (s['user_id'],)).fetchone()
            if not u or s['version'] != u['version'] or u['status'] in ('suspended', 'rejected') or s['expires'] <= now or s['last_seen'] <= now - 3600:
                db.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token),))
                return None
            if touch:
                db.execute('UPDATE sessions SET last_seen=? WHERE token_hash=?', (now, digest(token)))
            return {'user': public_user(u), 'scope': s['scope'], 'reauthenticated': s['reauthenticated']}

    def logout(self, token):
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token or ''),))

    def csrf(self, session_token):
        token, now = secrets.token_urlsafe(32), time.time()
        with self.connect() as db:
            db.execute('DELETE FROM csrf_tokens WHERE expires<?', (now,))
            db.execute('INSERT INTO csrf_tokens VALUES(?,?,?)', (digest(token), digest(session_token or ''), now + 1800))
        return token

    def check_csrf(self, cookie, header, session_token):
        if not cookie or not header or len(cookie) > 128 or len(header) > 128 or not secrets.compare_digest(cookie, header):
            return False
        with self.connect() as db:
            return bool(db.execute('SELECT 1 FROM csrf_tokens WHERE token_hash=? AND session_hash=? AND expires>?',
                                   (digest(cookie), digest(session_token or ''), time.time())).fetchone())

    def list_users(self, status='', query='', page=0):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM users WHERE (?='' OR status=?) AND (instr(username,?)>0 OR instr(displayName,?)>0) ORDER BY createdAt DESC LIMIT 51 OFFSET ?",
                              (status, status, query.lower(), query, page * 50)).fetchall()
            return {'users': [public_user(u) for u in rows[:50]], 'hasMore': len(rows) > 50}

    def change_user(self, actor, target, action, version, role=None):
        transitions = {'approve': ('pending', 'active'), 'reject': ('pending', 'rejected'), 'suspend': ('active', 'suspended'),
                       'restore': ('suspended', 'active'), 'reopen': ('rejected', 'pending')}
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            admin = db.execute('SELECT * FROM users WHERE id=?', (actor,)).fetchone()
            if not admin or admin['role'] != 'admin' or admin['status'] != 'active':
                raise AccessError(403, 'admin_required', '관리자 권한이 필요합니다.')
            user = db.execute('SELECT * FROM users WHERE id=?', (target,)).fetchone()
            if not user:
                raise AccessError(404, 'user_not_found', '계정을 찾을 수 없습니다.')
            if user['version'] != version:
                raise AccessError(409, 'account_changed', '다른 관리자가 변경했습니다. 목록을 새로고침해 주세요.')
            if actor == target:
                raise AccessError(403, 'self_change', '본인의 권한·상태는 변경할 수 없습니다.')
            status, new_role = user['status'], user['role']
            if action == 'change-role':
                if role not in ('admin', 'user') or status != 'active':
                    raise AccessError(422, 'invalid_role', '사용 중인 계정의 역할만 변경할 수 있습니다.')
                new_role = role
            elif action in transitions and status == transitions[action][0]:
                status = transitions[action][1]
            else:
                raise AccessError(409, 'invalid_transition', '현재 계정 상태에서 할 수 없는 작업입니다.')
            if user['role'] == 'admin' and user['status'] == 'active' and (status != 'active' or new_role != 'admin'):
                if db.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'").fetchone()[0] <= 1:
                    raise AccessError(409, 'last_admin', '마지막 관리자는 정지하거나 강등할 수 없습니다.')
            db.execute('UPDATE users SET status=?,role=?,version=version+1,reviewedAt=? WHERE id=?', (status, new_role, time.time(), target))
            if status == 'active' and user['status'] != 'active':
                self._check_tracking_capacity(db)
            db.execute('DELETE FROM sessions WHERE user_id=?', (target,))
            self._audit(db, actor, action, target)
            return public_user(db.execute('SELECT * FROM users WHERE id=?', (target,)).fetchone())

    def reauthenticate(self, token, password):
        s = self.session(token)
        if not s:
            raise AccessError(401, 'login_required', '다시 로그인해 주세요.')
        with self.connect() as db:
            row = db.execute('SELECT password_hash FROM users WHERE id=?', (s['user']['id'],)).fetchone()
            if not verify(row[0], password):
                raise AccessError(401, 'invalid_credentials', '비밀번호를 확인해 주세요.')
            db.execute('UPDATE sessions SET reauthenticated=? WHERE token_hash=?', (time.time(), digest(token)))

    def change_password(self, uid, old, new):
        encoded = password_hash(new)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
            if not row or not verify(row['password_hash'], old):
                raise AccessError(401, 'invalid_credentials', '현재 비밀번호를 확인해 주세요.')
            db.execute('UPDATE users SET password_hash=?,mustChangePassword=0,version=version+1 WHERE id=?', (encoded, uid))
            db.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
            self._audit(db, uid, 'password_changed', uid)

    def reset_password(self, username, password):
        encoded = password_hash(password)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT id FROM users WHERE username=?', (identity(username),)).fetchone()
            if not row:
                raise AccessError(404, 'user_not_found', '계정을 찾을 수 없습니다.')
            db.execute('UPDATE users SET password_hash=?,mustChangePassword=1,version=version+1 WHERE id=?', (encoded, row['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
            self._audit(db, None, 'operator_password_reset', row['id'])

    def workspace(self, uid):
        with self.connect() as db:
            row = db.execute('SELECT * FROM workspaces WHERE user_id=?', (uid,)).fetchone()
        return {'revision': row['revision'] if row else 0,
                'workspace': json.loads(row['payload']) if row else {'version': 1, 'watchlist': [], 'vessels': [], 'voyages': []},
                'destinations': json.loads(row['destinations']) if row else {}}

    def tracking_members(self):
        with self.connect() as db:
            return self._tracking_members(db)

    def _tracking_members(self, db):
        rows = db.execute("SELECT w.user_id,w.payload FROM workspaces w JOIN users u ON u.id=w.user_id WHERE u.status='active'").fetchall()
        result = {}
        for row in rows:
            payload = json.loads(row['payload'])
            interests = set(payload['watchlist'])
            result[row['user_id']] = [{'source': 'digitraffic' if v['source'] == 'digitraffic' else 'aisstream', 'mmsi': v['mmsi']}
                                      for v in payload['vessels'] if v['id'] in interests and v['source'] != 'demo' and re.fullmatch(r'[1-9]\d{8}', v['mmsi'])]
        return result

    def _check_tracking_capacity(self, db):
        from midterm.vessels.navigation import MAX_TRACKED_VESSELS
        keys = {(v['source'], v['mmsi']) for members in self._tracking_members(db).values() for v in members}
        if len(keys) > MAX_TRACKED_VESSELS:
            raise AccessError(409, 'tracking_capacity', '서버의 관심 선박 추적 한도(중복 제외 1,000척)를 초과합니다. 관심 선박 수를 줄인 후 다시 저장해 주세요.')

    def save_workspace(self, uid, revision, payload, destinations):
        from .workspace import checked_workspace
        payload, destinations = checked_workspace(payload, destinations)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision FROM workspaces WHERE user_id=?', (uid,)).fetchone()
            if (row['revision'] if row else 0) != revision:
                raise AccessError(409, 'workspace_conflict', '다른 창 또는 기기에서 목록이 변경되었습니다. 새로 불러온 뒤 다시 적용해 주세요.')
            db.execute('INSERT INTO workspaces VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,destinations=excluded.destinations',
                       (uid, revision + 1, json.dumps(payload, ensure_ascii=False), json.dumps(destinations)))
            self._check_tracking_capacity(db)
        return {'revision': revision + 1, 'workspace': payload, 'destinations': destinations}
