"""Optional, bounded Open Waters stream feeding the shared MMSI catalog.

No credential is sent to AISstream or exposed in diagnostics. Native events keep
    their observation time and upstream identity; cache-only reconstructions are excluded.
"""
import asyncio
from contextlib import suppress
from datetime import datetime, timezone
import json
import os
import random
import re

from .ais import MESSAGE_TYPES, POSITION_TYPES, epoch, number, utc_now

DEFAULT_BOXES = [[36.8, 126.4, 37.2, 126.9]]  # Pyeongtaek / Dangjin approaches
UPSTREAMS = {'aishub', 'aisstream', 'digitraffic', 'kystverket', 'barentswatch',
             'station', 'udp', 'mmsi'}


class OpenWatersReceiver:
    def __init__(self, ingest, enabled=None):
        self.ingest = ingest
        self.enabled = os.getenv('OPENWATERS_ENABLED', '') == '1' if enabled is None else enabled
        self._token = os.getenv('OPENWATERS_API_TOKEN', '').strip()
        self.boxes = DEFAULT_BOXES
        self.status = 'idle' if self.enabled else 'disabled'
        self.last_received_at = None
        self._task = None
        configured = os.getenv('OPENWATERS_BOUNDING_BOXES')
        if self.enabled and configured:
            try:
                boxes = json.loads(configured)
                if not isinstance(boxes, list) or not 1 <= len(boxes) <= 8:
                    raise ValueError()
                area = 0
                for b in boxes:
                    if not isinstance(b, list) or len(b) != 4:
                        raise ValueError()
                    if any(number(v, -90 if i % 2 == 0 else -180,
                                  90 if i % 2 == 0 else 180) is None for i, v in enumerate(b)):
                        raise ValueError()
                    if b[0] >= b[2] or b[1] >= b[3]:
                        raise ValueError()
                    area += (b[2] - b[0]) * (b[3] - b[1])
                if area > 100:  # Stay within the anonymous tier even with a token.
                    raise ValueError()
                self.boxes = boxes
            except (ValueError, TypeError):
                self.status = 'configuration_error'

    def start(self):
        if self.enabled and self.status != 'configuration_error' and (self._task is None or self._task.done()):
            self.status = 'connecting'
            self._task = asyncio.create_task(self._receive())

    async def stop(self):
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def summary(self):
        return {'status': self.status, 'lastReceivedAt': self.last_received_at,
                'bounds': self.boxes}

    def handle(self, event):
        if not isinstance(event, dict) or event.get('type') != 'event' or not isinstance(event.get('synthesized'), bool):
            return False
        # Documented JSON feeds (e.g. AISHub) are re-encoded into AIS frames and
        # marked synthesized. These are observations, not extrapolated positions.
        # Cache reconstructions lack id/NMEA; own-GPS reports use another source.
        reencoded = event['synthesized']
        if reencoded:
            nmea = event.get('nmea')
            if (event.get('source') not in {'aishub', 'aisstream', 'digitraffic', 'kystverket', 'barentswatch'}
                    or not isinstance(event.get('id'), str) or not re.fullmatch(r'[0-9a-f]{20,64}', event['id'])
                    or not isinstance(nmea, list) or not 1 <= len(nmea) <= 16
                    or any(not isinstance(n, str) or not n.startswith('!AIVDM,') or len(n) > 128 for n in nmea)):
                return False
        kind, report = event.get('msg_type'), event.get('message')
        if kind not in MESSAGE_TYPES or not isinstance(report, dict) or report.get('Valid') is False:
            return False
        mmsi = str(event.get('mmsi', ''))
        if not re.fullmatch(r'[1-9]\d{8}', mmsi) or str(report.get('UserID')) != mmsi:
            return False
        try:
            stamp = event['time']
            observed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if observed.tzinfo is None or observed > datetime.now(timezone.utc) or observed.year < 2000:
                return False
        except (KeyError, ValueError, TypeError, AttributeError):
            return False
        if kind in POSITION_TYPES:
            lat, lon = report.get('Latitude'), report.get('Longitude')
            if number(lat, -90, 90) is None or number(lon, -180, 180) is None:
                return False
            if not any(s <= lat <= n and w <= lon <= e for s, w, n, e in self.boxes):
                return False
        # Never use envelope lat/lon for a static message: it is a cached fix.
        raw_source = event.get('source')
        upstream = raw_source.split(':', 1)[0] if isinstance(raw_source, str) else ''
        upstream = upstream if upstream in UPSTREAMS else 'other'
        received = utc_now()
        accepted = self.ingest({'MessageType': kind,
                               'MetaData': {'MMSI': int(mmsi), 'time_utc': stamp},
                               'Message': {kind: report}}, received,
                              feed='openwaters', upstream=upstream, reencoded=reencoded)
        if accepted:
            self.last_received_at = received
        return bool(accepted)

    async def _receive(self):
        from websockets.asyncio.client import connect
        delay = 2
        while True:
            try:
                headers = {'Authorization': f'Bearer {self._token}'} if self._token else None
                async with connect('wss://ais.openwaters.io/v1/stream', additional_headers=headers,
                                   compression='deflate', open_timeout=15, close_timeout=5,
                                   max_size=1048576, max_queue=32) as socket:
                    await socket.send(json.dumps({'type': 'subscribe', 'bbox': self.boxes, 'snapshot': True}))
                    self.status = 'waiting'
                    async for frame in socket:
                        try:
                            event = json.loads(frame)
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if isinstance(event, dict) and event.get('type') == 'error':
                            # Never forward provider bodies; they can contain credentials.
                            self.status = 'provider_error'
                            return
                        if self.handle(event):
                            self.status = 'receiving'
                            delay = 2
            except Exception:
                pass  # Isolated failure; original AISstream collection continues.
            self.status = 'reconnecting'
            await asyncio.sleep(delay + random.random())
            delay = min(60, delay * 2)
