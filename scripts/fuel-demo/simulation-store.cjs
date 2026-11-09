'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const DAY = 24 * 60 * 60 * 1000;

/** Telemetry history is bounded: at most maxRows rows and maxAgeMs of age; the latest row always stays. */
function openSimulationStore(path, { maxRows = 20000, maxAgeMs = 7 * DAY, pruneEvery = 100 } = {}) {
  if (typeof path !== 'string' || !path) throw Error('모의 운전 DB 경로를 확인하세요.');
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS simulation_samples (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, state TEXT NOT NULL);');
  if (!db.prepare('PRAGMA table_info(simulation_samples)').all().some(row => row.name === 'checkpoint'))
    db.exec('ALTER TABLE simulation_samples ADD COLUMN checkpoint TEXT');
  const insert = db.prepare('INSERT INTO simulation_samples(at,state,checkpoint) VALUES(?,?,?)');
  const latest = db.prepare('SELECT at,state,checkpoint FROM simulation_samples ORDER BY id DESC LIMIT 1');
  const keepRecent = db.prepare('DELETE FROM simulation_samples WHERE id <= (SELECT id FROM simulation_samples ORDER BY id DESC LIMIT 1 OFFSET ?)');
  const dropOld = db.prepare('DELETE FROM simulation_samples WHERE at < ? AND id < (SELECT MAX(id) FROM simulation_samples)');
  const count = db.prepare('SELECT COUNT(*) AS n FROM simulation_samples');
  let inserted = 0;
  const prune = () => { keepRecent.run(maxRows); dropOld.run(Date.now() - maxAgeMs); };
  prune();
  return {
    record(state, at = Date.now(), checkpoint = null) {
      if (!state || state.source !== 'demo' || !Number.isFinite(at)) throw Error('모의 운전 값만 저장할 수 있습니다.');
      insert.run(at, JSON.stringify(state), checkpoint ? JSON.stringify(checkpoint) : null);
      if (++inserted % pruneEvery === 0) prune();
    },
    prune,
    count() { return count.get().n; },
    latest() { const row = latest.get(); return row ? {at:row.at,state:JSON.parse(row.state),checkpoint:row.checkpoint ? JSON.parse(row.checkpoint) : null} : null; },
    close() { db.close(); },
  };
}
module.exports = {openSimulationStore};
