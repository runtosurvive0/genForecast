"""Public single-file frontend only; authenticated API runs in its own service."""
import os
from pathlib import Path
from starlette.applications import Starlette
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse, PlainTextResponse
from starlette.routing import Route


def create_app(file):
    path = Path(file)

    async def index(request):
        if not path.is_file():
            return PlainTextResponse('Frontend is not available.', status_code=503)
        return FileResponse(path, media_type='text/html', headers={
            'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'})

    application = Starlette(routes=[Route('/', index, methods=['GET', 'HEAD'])])
    application.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    return application


app = create_app(os.getenv('GENFORECAST_FRONTEND_FILE', 'public/index.html'))
