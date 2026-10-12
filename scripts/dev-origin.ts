import type { Plugin, ViteDevServer } from 'vite';

export function developmentBackend(env: Record<string, string | undefined>) {
  const target = env.MIDTERM_API_TARGET?.trim() || 'https://zgx-6660.tailec6d33.ts.net';
  const url = new URL(target);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== target || !(url.protocol === 'https:' || url.protocol === 'http:' && local)) {
    throw new Error('MIDTERM_API_TARGET must be an exact HTTPS origin or a loopback HTTP origin');
  }
  return { target, origin: env.MIDTERM_API_ORIGIN?.trim() || (url.protocol === 'https:' ? url.origin : undefined) };
}

export function devOriginBridge(origin: string): Plugin {
  const remote = new URL(origin);
  if (remote.protocol !== 'https:' || remote.origin !== origin) {
    throw new Error('MIDTERM_API_ORIGIN must be an exact HTTPS origin without a path or credentials');
  }
  const configure = (server: Pick<ViteDevServer, 'httpServer' | 'middlewares'>) => {
      // This adapter is exclusively for loopback dev/preview servers. Do not
      // blindly rewrite Origin in the proxy: that would bless cross-site requests.
      server.middlewares.use('/api', (req, res, next) => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : null;
        const host = req.headers.host;
        const ownHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
        const incoming = req.headers.origin;
        const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '');
        if (!loopback || !port || !host || !ownHosts.has(host) ||
            (incoming !== undefined ? incoming !== `http://${host}` : !safe)) {
          res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ code: 'invalid_origin', detail: 'Local development requests only.' }));
          return;
        }
        req.headers.origin = origin;
        next();
      });
  };
  return {
    name: 'genforecast-dev-origin',
    apply: 'serve',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
