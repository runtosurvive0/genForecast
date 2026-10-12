import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer, request } from 'node:http';
import { createServer, preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { devOriginBridge, developmentBackend } from '../scripts/dev-origin.ts';

test('fresh checkout uses shared ZGX HTTPS without local secrets or an SSH tunnel', () => {
  const settings = developmentBackend({});
  assert.deepEqual(settings, { target: 'https://zgx-6660.tailec6d33.ts.net', origin: 'https://zgx-6660.tailec6d33.ts.net' });
});

test('explicit local backend remains isolated while custom HTTPS derives its origin', () => {
  assert.deepEqual(developmentBackend({ MIDTERM_API_TARGET: 'http://127.0.0.1:8094' }),
    { target: 'http://127.0.0.1:8094', origin: undefined });
  assert.deepEqual(developmentBackend({ MIDTERM_API_TARGET: 'https://other.example' }),
    { target: 'https://other.example', origin: 'https://other.example' });
  assert.deepEqual(developmentBackend({ MIDTERM_API_TARGET: 'http://127.0.0.1:8093', MIDTERM_API_ORIGIN: 'https://team.example' }),
    { target: 'http://127.0.0.1:8093', origin: 'https://team.example' });
  for (const target of ['http://remote.example', 'https://user:password@team.example', 'https://team.example/api']) {
    assert.throws(() => developmentBackend({ MIDTERM_API_TARGET: target }));
  }
});

test('local dev proxy translates only its own browser origin and retains cookie protection', async () => {
  let calls = 0;
  const upstream = httpServer((req, res) => {
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'gf_csrf=test-only; Path=/; Secure; HttpOnly; SameSite=Lax');
    res.end(JSON.stringify({ origin: req.headers.origin, csrf: req.headers['x-csrf-token'] }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as import('node:net').AddressInfo).port;
  const dev = await createServer({ configFile: false, cacheDir: '.tooling-tmp/dev-origin-test-cache',
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: [devOriginBridge('https://team.example')],
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${upstreamPort}`, changeOrigin: true } } } });
  try {
    await dev.listen();
    const port = (dev.httpServer!.address() as import('node:net').AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    for (const host of ['127.0.0.1', 'localhost']) {
      const response = await fetch(`http://${host}:${port}/api/test`, { method: 'POST', headers: {
        Origin: `http://${host}:${port}`, 'X-CSRF-Token': 'test-only' } });
      assert.equal(response.status, 200, host);
      assert.deepEqual(await response.json(), { origin: 'https://team.example', csrf: 'test-only' });
      assert.match(response.headers.get('set-cookie')!, /Secure; HttpOnly; SameSite=Lax/);
    }
    const before = calls;
    for (const origin of ['https://evil.example', 'null', `http://localhost:${port + 1}`, 'https://team.example']) {
      const response = await fetch(base + '/api/test', { method: 'POST', headers: { Origin: origin } });
      assert.equal(response.status, 403);
    }
    assert.equal((await fetch(base + '/api/test', { method: 'POST' })).status, 403);
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + '/api/test', { headers: { Host: `evil.example:${port}` } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHostStatus, 403);
    assert.equal(calls, before, 'Rejected origins must not reach the upstream');
    assert.equal((await fetch(base + '/api/test')).status, 200);
  } finally {
    await dev.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});

test('bridge requires an exact HTTPS upstream origin', () => {
  for (const value of ['http://team.example', 'https://team.example/path', 'https://user:pass@team.example', 'https://team.example?x=1']) {
    assert.throws(() => devOriginBridge(value));
  }
});

test('local preview applies the same origin guard as development before proxying', async () => {
  let calls = 0;
  const upstream = httpServer((req, res) => {
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ origin: req.headers.origin }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as import('node:net').AddressInfo).port;
  const outDir = '.tooling-tmp/dev-origin-preview-dist';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/index.html`, '<!doctype html><title>Preview proxy test</title>');
  const server = await preview({ configFile: false, build: { outDir },
    plugins: [devOriginBridge('https://team.example')],
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${upstreamPort}` } } } });
  try {
    const port = (server.httpServer.address() as import('node:net').AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const result = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base } });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { origin: 'https://team.example' });
    const before = calls;
    for (const origin of ['https://evil.example', 'null', 'https://team.example', `${base}1`]) {
      assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { Origin: origin } })).status, 403);
    }
    assert.equal((await fetch(base + '/api/login', { method: 'POST' })).status, 403);
    assert.equal(calls, before);
  } finally {
    await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
