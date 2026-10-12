"""TEST ONLY: isolated auth API, no operational database or live integrations."""
import os
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI
import uvicorn
from midterm.auth.store import AccessStore
from midterm.web.auth_api import install_access

db = Path(__file__).resolve().parents[2] / '.tooling-tmp' / f'auth-ui-{uuid4()}.sqlite3'
store = AccessStore(db)
store.init_admin('test-admin', 'Test Administrator', 'only-for-isolated-ui-tests-2026')
app = FastAPI()
origins = {f'http://127.0.0.1:{os.getenv("MIDTERM_DEV_PORT", "5173")}', 'http://127.0.0.1:8097'}
install_access(app, store, origins, secure=False)

@app.get('/api/vessels/tracking/{owner}')
@app.put('/api/vessels/tracking/{owner}')
def tracking(owner: str):
    return {'vessels': [], 'status': 'not_configured'}

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8097, log_level='warning')
