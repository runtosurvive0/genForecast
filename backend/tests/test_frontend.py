from fastapi.testclient import TestClient


def test_public_frontend_is_compressed_without_exposing_files(tmp_path):
    from midterm.web.frontend import create_app
    file = tmp_path / 'index.html'
    html = '<!doctype html><html>' + 'hello ' * 1000 + '</html>'
    file.write_text(html, encoding='utf-8')
    (tmp_path / '.env').write_text('secret')
    with TestClient(create_app(file)) as client:
        compressed = client.get('/', headers={'Accept-Encoding': 'gzip'})
        assert compressed.status_code == 200 and compressed.text == html
        assert compressed.headers['content-encoding'] == 'gzip'
        assert 'Accept-Encoding' in compressed.headers['vary']
        assert len(compressed.content) > 1000
        plain = client.get('/', headers={'Accept-Encoding': 'identity'})
        assert plain.text == html and 'content-encoding' not in plain.headers
        assert client.head('/').status_code == 200
        assert client.post('/').status_code == 405
        for path in ('/.env', '/backend/data/access.sqlite3', '/../.env', '/api/auth/login'):
            assert client.get(path).status_code == 404


def test_missing_frontend_fails_closed(tmp_path):
    from midterm.web.frontend import create_app
    with TestClient(create_app(tmp_path / 'missing.html')) as client:
        response = client.get('/')
        assert response.status_code == 503
        assert str(tmp_path) not in response.text
