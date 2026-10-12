"""Compress the large public AIS fields, never authentication/token responses."""
from starlette.middleware.gzip import GZipMiddleware


class CatalogCompressionMiddleware:
    def __init__(self, app):
        self.app = app
        self.compressed = GZipMiddleware(app, minimum_size=1024, compresslevel=5)

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope['path'] == '/api/vessels/catalog':
            await self.compressed(scope, receive, send)
        else:
            await self.app(scope, receive, send)
