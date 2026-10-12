"""Committed latest AIS catalog, separate from registered-vessel track history."""
from pathlib import Path
import json
import sqlite3
from threading import RLock


class DiscoveryStore:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(path, timeout=15, check_same_thread=False)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.executescript('''
            CREATE TABLE IF NOT EXISTS discovery (
                mmsi TEXT PRIMARY KEY, vessel TEXT NOT NULL,
                general_order INTEGER, korea_order INTEGER, candidate TEXT
            );
            CREATE TABLE IF NOT EXISTS discovery_meta (key TEXT PRIMARY KEY, value TEXT);
        ''')
        self._db.commit()

    def save(self, changes, last_received_at):
        with self._lock, self._db:
            for mmsi, value in changes.items():
                if value is None:
                    self._db.execute('DELETE FROM discovery WHERE mmsi=?', (mmsi,))
                else:
                    self._db.execute('''INSERT INTO discovery VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(mmsi) DO UPDATE SET vessel=excluded.vessel,
                        general_order=excluded.general_order, korea_order=excluded.korea_order,
                        candidate=excluded.candidate''', (mmsi, *value))
            self._db.execute('INSERT OR REPLACE INTO discovery_meta VALUES (?, ?)',
                             ('last_received_at', last_received_at))

    def load(self):
        with self._lock:
            # One lock covers both reads so callers never see a partial committed batch.
            rows = self._db.execute('SELECT * FROM discovery').fetchall()
            stamp = self._db.execute("SELECT value FROM discovery_meta WHERE key='last_received_at'").fetchone()
        return rows, stamp[0] if stamp else None

    def find(self, mmsi):
        with self._lock:
            return self._db.execute('SELECT * FROM discovery WHERE mmsi=?', (mmsi,)).fetchone()

    def snapshot(self, now):
        from .ais import epoch, MAX_VESSELS, MAX_KOREA_CANDIDATES, KOREA_RETENTION_HOURS
        rows, stamp = self.load()
        general, candidates = [], []
        for _, raw, rank, korea_rank, metadata in rows:
            vessel = json.loads(raw)
            if rank is not None:
                general.append((rank, vessel))
            if metadata is not None:
                candidate = json.loads(metadata)
                if epoch(now) - epoch(candidate['destinationObservedAt']) < KOREA_RETENTION_HOURS * 3600:
                    candidates.append((korea_rank, {'vessel': vessel, **candidate}))
        return {'lastReceivedAt': stamp, 'capacity': MAX_VESSELS,
                'vessels': [v for _, v in sorted(general, key=lambda row: row[0], reverse=True)][:MAX_VESSELS],
                'koreaCandidates': {'capacity': MAX_KOREA_CANDIDATES, 'retentionHours': KOREA_RETENTION_HOURS,
                                    'entries': [v for _, v in sorted(candidates, key=lambda row: row[0], reverse=True)][:MAX_KOREA_CANDIDATES]}}

    def close(self):
        with self._lock:
            self._db.close()
