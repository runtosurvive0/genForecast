"""Deny-by-default online access, independent of the React login gate."""
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from midterm.auth.store import AccessError, AccessStore, digest

SESSION_COOKIE = 'gf_session'
CSRF_COOKIE = 'gf_csrf'
DEFAULT_ORIGINS = {f'http://{host}:{port}' for host in ('127.0.0.1', 'localhost') for port in (5173, 4173, 8093, 8090)}
PUBLIC = {'/api/auth/bootstrap-status', '/api/auth/csrf', '/api/auth/session', '/api/auth/register', '/api/auth/login', '/api/auth/logout'}
LIMITED = {'/api/auth/password'}
READ_POST = {'/api/vessels/destinations/resolve', '/api/supply/forecast', '/api/outages/parse'}
ADMIN_WRITES = {('/api/settings', 'PUT'), ('/api/fuel-settings', 'PUT'), ('/api/run', 'POST'), ('/api/preview', 'POST'),
                ('/api/supply/baselines', 'POST'), ('/api/supply/vessels', 'POST'), ('/api/supply/transfers', 'POST'),
                ('/api/supply/config', 'PUT'), ('/api/supply/plans', 'POST'),
                ('/api/planning/inputs/upload', 'POST'), ('/api/supply/simulation-stock', 'POST'),
                ('/api/supply/port-visits', 'POST')}


def get_store(request):
    return store_for_app(request.app)


def store_for_app(app):
    if app.state.access_store is None:
        path = os.environ.get('GENFORECAST_ACCESS_DB') or str(Path(__file__).resolve().parents[3] / 'data' / 'access.sqlite3')
        app.state.access_store = AccessStore(path)
    return app.state.access_store


def failure(error):
    headers = {'Cache-Control': 'no-store'}
    if error.retry_after:
        headers['Retry-After'] = str(error.retry_after)
    return JSONResponse({'code': error.code, 'detail': str(error)}, status_code=error.status, headers=headers)


class Register(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(max_length=64)
    displayName: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class Password(BaseModel):
    model_config = ConfigDict(extra='forbid')
    currentPassword: str = Field(max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class Action(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: str = Field(max_length=24)
    version: int = Field(strict=True, ge=1)
    role: str | None = Field(default=None, max_length=16)


async def body(request, model=None):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 1000000:
            raise AccessError(413, 'body_too_large', '요청은 1MB 이하로 보내 주세요.')
    try:
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError()
        return model.model_validate(value) if model else value
    except (ValidationError, ValueError, TypeError):
        raise AccessError(422, 'invalid_input', '입력 형식과 길이를 확인해 주세요.') from None


def install_access(app, store=None, origins=None, secure=None):
    app.state.access_store = store
    allowed = origins if origins is not None else set(filter(None, (x.strip() for x in os.getenv('GENFORECAST_ORIGINS', '').split(',')))) or DEFAULT_ORIGINS
    # Non-loopback deployments require HTTPS. No flag can disable authentication.
    for origin in allowed:
        parts = urlsplit(origin)
        if parts.scheme not in ('http', 'https') or not parts.netloc or parts.path or parts.query or parts.fragment or parts.username:
            raise ValueError('GENFORECAST_ORIGINS must contain exact origins')
        if parts.scheme == 'http' and parts.hostname not in ('127.0.0.1', 'localhost', '::1', 'testserver'):
            raise ValueError('Non-local origins require HTTPS')
    secure_cookie = secure if secure is not None else not all(x.startswith('http://') for x in allowed)
    hosts = {urlsplit(o).hostname for o in allowed} | {'127.0.0.1', 'localhost', '::1'}

    @app.exception_handler(AccessError)
    async def access_error_handler(request, exc):
        return failure(exc)

    @app.middleware('http')
    async def access_boundary(request, call_next):
        path = request.url.path
        if request.url.hostname not in hosts:
            return failure(AccessError(400, 'invalid_host', '허용되지 않은 서버 주소입니다.'))
        if path.startswith('/assets/'):
            return await call_next(request)
        origin = request.headers.get('origin')
        if origin is not None and origin not in allowed:
            return failure(AccessError(403, 'invalid_origin', '허용되지 않은 접속 경로입니다.'))
        try:
            db = await run_in_threadpool(get_store, request)
            token = request.cookies.get(SESSION_COOKIE, '')
            # Status polling should not extend an otherwise idle session.
            session = await run_in_threadpool(db.session, token, False)
            request.state.session = session
            expected_account = request.headers.get('x-account-id')
            if session and ((expected_account and expected_account != session['user']['id']) or
                            (path == '/api/me/vessel-workspace' and not expected_account)):
                raise AccessError(403, 'account_changed', '다른 창에서 계정이 변경되었습니다. 다시 로그인해 주세요.')
            if path not in PUBLIC:
                if not session:
                    raise AccessError(401, 'login_required', '로그인이 필요합니다.')
                if path not in LIMITED and session['scope'] != 'full':
                    raise AccessError(403, 'approval_required', '관리자 승인 또는 비밀번호 변경 후 다시 로그인해 주세요.')
                if path.startswith('/api/admin/') or path in ('/docs', '/redoc', '/openapi.json'):
                    if session['user']['role'] != 'admin':
                        raise AccessError(403, 'admin_required', '관리자 권한이 필요합니다.')
                match = re.match(r'^/api/vessels/(?:tracking|weather|port-visits)/([^/]+)', path)
                if match and match[1] != session['user']['id']:
                    raise AccessError(403, 'owner_mismatch', '본인의 관심 선박만 조회할 수 있습니다.')
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                if origin not in allowed or not await run_in_threadpool(db.check_csrf, request.cookies.get(CSRF_COOKIE), request.headers.get('x-csrf-token'), token):
                    raise AccessError(403, 'csrf_failed', '요청 확인 정보가 만료되었습니다. 다시 시도해 주세요.')
                if path not in PUBLIC and path not in LIMITED:
                    user_write = path in READ_POST and request.method == 'POST' or path == '/api/me/vessel-workspace' and request.method == 'PUT' or bool(re.fullmatch(r'/api/vessels/tracking/[^/]+', path)) and request.method == 'PUT' or path == '/api/auth/reauthenticate' and request.method == 'POST'
                    admin_write = (path, request.method) in ADMIN_WRITES or bool(re.fullmatch(r'/api/supply/vessels/[^/]+/(unloading|schedule)', path)) and request.method in ('POST', 'PUT') or bool(re.fullmatch(r'/api/admin/users/[^/]+/actions', path)) and request.method == 'POST'
                    if not user_write and not (admin_write and session['user']['role'] == 'admin'):
                        raise AccessError(403, 'write_forbidden', '이 변경에는 관리자 권한이 필요하거나 지원되지 않는 요청입니다.')
            response = await call_next(request)
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            return response
        except AccessError as exc:
            return failure(exc)

    router = APIRouter()

    def cookie(response, name, token, age):
        response.set_cookie(name, token, max_age=age, httponly=True, secure=secure_cookie, samesite='lax', path='/')

    @router.get('/api/auth/bootstrap-status')
    def bootstrap(request: Request):
        return {'setupRequired': not get_store(request).initialized()}

    @router.get('/api/auth/csrf')
    def csrf_token(request: Request):
        db = get_store(request)
        ip = request.client.host if request.client else 'unknown'
        db.rate_limit('csrf:' + ip, 120, 60)
        value = db.csrf(request.cookies.get(SESSION_COOKIE))
        response = JSONResponse({'token': value})
        cookie(response, CSRF_COOKIE, value, 1800)
        return response

    @router.get('/api/auth/session')
    def session_info(request: Request):
        session = request.state.session
        if session:
            # Only explicit UI activity sends this; background data polling does not.
            if request.headers.get('x-user-activity') == '1':
                get_store(request).session(request.cookies.get(SESSION_COOKIE), True)
            return {'user': session['user'], 'scope': session['scope']}
        return {'user': None, 'scope': None}

    @router.post('/api/auth/register', status_code=201)
    async def register(request: Request):
        db = get_store(request)
        value = await body(request, Register)
        await run_in_threadpool(db.rate_limit, 'register:' + request.client.host, 10, 3600)
        user = await run_in_threadpool(db.register, value.username, value.displayName, value.password)
        return {'user': user}

    @router.post('/api/auth/login')
    async def login(request: Request):
        db = get_store(request)
        value = await body(request, Login)
        await run_in_threadpool(db.rate_limit, 'login-ip:' + request.client.host, 30, 900)
        await run_in_threadpool(db.rate_limit, 'login-user:' + digest(value.username.strip().lower()), 5, 900)
        token = await run_in_threadpool(db.login, value.username, value.password)
        await run_in_threadpool(db.logout, request.cookies.get(SESSION_COOKIE))
        session = await run_in_threadpool(db.session, token)
        response = JSONResponse({'user': session['user'], 'scope': session['scope']})
        cookie(response, SESSION_COOKIE, token, 43200 if session['scope'] == 'full' else 1800)
        response.delete_cookie(CSRF_COOKIE, path='/')
        return response

    @router.post('/api/auth/logout')
    def logout(request: Request):
        get_store(request).logout(request.cookies.get(SESSION_COOKIE))
        response = JSONResponse({'ok': True})
        response.delete_cookie(SESSION_COOKIE, path='/')
        response.delete_cookie(CSRF_COOKIE, path='/')
        return response

    @router.post('/api/auth/reauthenticate')
    async def reauthenticate(request: Request):
        value = await body(request)
        if set(value) != {'password'} or not isinstance(value['password'], str) or len(value['password']) > 128:
            raise AccessError(422, 'invalid_input', '비밀번호를 확인해 주세요.')
        db = get_store(request)
        await run_in_threadpool(db.rate_limit, 'reauth:' + request.state.session['user']['id'], 5, 900)
        await run_in_threadpool(db.reauthenticate, request.cookies.get(SESSION_COOKIE), value['password'])
        return {'ok': True}

    @router.put('/api/auth/password')
    async def change_password(request: Request):
        value = await body(request, Password)
        session = request.state.session
        if session['scope'] == 'pending':
            raise AccessError(403, 'approval_required', '승인 후 변경할 수 있습니다.')
        db = get_store(request)
        await run_in_threadpool(db.rate_limit, 'password:' + session['user']['id'], 5, 900)
        await run_in_threadpool(db.change_password, session['user']['id'], value.currentPassword, value.newPassword)
        response = JSONResponse({'ok': True})
        response.delete_cookie(SESSION_COOKIE, path='/')
        response.delete_cookie(CSRF_COOKIE, path='/')
        return response

    @router.get('/api/admin/users')
    def users(request: Request, status: str = '', q: str = '', page: int = 0):
        if status not in ('', 'pending', 'active', 'rejected', 'suspended') or len(q) > 100 or not 0 <= page <= 10000:
            raise AccessError(422, 'invalid_filter', '조회 조건을 확인해 주세요.')
        return get_store(request).list_users(status, q, page)

    @router.post('/api/admin/users/{uid}/actions')
    async def user_action(uid: str, request: Request):
        value = await body(request, Action)
        s = request.state.session
        if value.action == 'change-role' and time.time() - s['reauthenticated'] > 300:
            raise AccessError(403, 'reauth_required', '관리자 비밀번호를 다시 확인해 주세요.')
        user = await run_in_threadpool(get_store(request).change_user, s['user']['id'], uid, value.action, value.version, value.role)
        return {'user': user}

    @router.get('/api/me/vessel-workspace')
    def workspace(request: Request):
        return get_store(request).workspace(request.state.session['user']['id'])

    @router.put('/api/me/vessel-workspace')
    async def save_workspace(request: Request):
        value = await body(request)
        if set(value) != {'revision', 'workspace', 'destinations'} or type(value['revision']) is not int or value['revision'] < 0:
            raise AccessError(422, 'invalid_workspace', '목록 버전과 형식을 확인해 주세요.')
        return await run_in_threadpool(get_store(request).save_workspace, request.state.session['user']['id'], value['revision'], value['workspace'], value['destinations'])

    app.include_router(router)
