"""Explicit live probe: isolated temp DB only, no accounts or production paths.

Run PYTHONPATH=src python tests/probe_openwaters.py. This is not an automatic test.
"""
import asyncio
import json
import tempfile
from pathlib import Path

from midterm.vessels.ais import AisCatalog, utc_now
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.openwaters import OpenWatersReceiver
from midterm.vessels.fleet_map import fleet_map


async def main():
    with tempfile.TemporaryDirectory(prefix='openwaters-probe-') as folder:
        store = DiscoveryStore(Path(folder) / 'isolated.sqlite3')
        catalog = AisCatalog(api_key='', store=store)
        receiver = OpenWatersReceiver(catalog.ingest, enabled=True)
        receiver.start()
        try:
            await asyncio.sleep(25)
        finally:
            await receiver.stop()
        await catalog.flush()
        snapshot = store.snapshot(utc_now())
        mapped = fleet_map(store, 126.4, 126.9, 36.8, 37.2, 14, utc_now())
        print(json.dumps({'status': receiver.status, 'saved': len(snapshot['vessels']),
                          'mapCount': mapped['visibleCount'],
                          'sources': sorted({v['ais']['position'].get('upstream', '')
                                             for v in snapshot['vessels'] if v['ais']['position']}),
                          'productionTouched': False}))
        store.close()
        assert mapped['visibleCount'] > 0, 'No actual positions received in probe window'


if __name__ == '__main__':
    asyncio.run(main())
