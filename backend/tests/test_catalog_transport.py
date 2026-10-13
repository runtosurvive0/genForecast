from fastapi import FastAPI
from fastapi.testclient import TestClient

from midterm.web.catalog_transport import CatalogCompressionMiddleware


def test_catalog_compresses_without_changing_json_or_private_cache_policy():
    app = FastAPI()
    app.add_middleware(CatalogCompressionMiddleware)
    payload = {'vessels': [{'mmsi': str(440000000 + i), 'name': 'TEST CARGO'} for i in range(120000)]}

    @app.get('/api/vessels/catalog')
    def catalog():
        from fastapi.responses import JSONResponse
        return JSONResponse(payload, headers={'Cache-Control': 'no-store'})

    with TestClient(app) as client:
        compressed = client.get('/api/vessels/catalog', headers={'Accept-Encoding': 'gzip'})
        plain = client.get('/api/vessels/catalog', headers={'Accept-Encoding': 'identity'})
        assert compressed.json() == plain.json() == payload
        assert compressed.headers['content-encoding'] == 'gzip'
        assert 'content-encoding' not in plain.headers
        assert compressed.headers['cache-control'] == 'no-store'
        assert 'Accept-Encoding' in compressed.headers['vary']
        assert int(compressed.headers['content-length']) < len(plain.content) / 4


def test_other_endpoints_and_auth_denials_are_not_compressed():
    from starlette.middleware.base import BaseHTTPMiddleware
    from fastapi.responses import JSONResponse
    app = FastAPI()
    app.add_middleware(CatalogCompressionMiddleware)

    class AccessGuard(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            if request.url.path == '/api/vessels/catalog':
                return JSONResponse({'detail': 'login required'}, status_code=401)
            return await call_next(request)

    app.add_middleware(AccessGuard)

    @app.get('/api/auth/csrf')
    def csrf():
        return {'token': 'test-only-' * 200}

    with TestClient(app) as client:
        for path, status in [('/api/vessels/catalog', 401), ('/api/auth/csrf', 200)]:
            result = client.get(path, headers={'Accept-Encoding': 'gzip'})
            assert result.status_code == status
            assert 'content-encoding' not in result.headers
