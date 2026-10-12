// Shared CSRF handling for the legacy Python HTML tools. Authorization is server-side.
(() => {
  const native = window.fetch.bind(window);
  const account = document.querySelector('meta[name="genforecast-account"]').content;
  let csrf;
  const token = () => csrf ??= native('/api/auth/csrf', { cache: 'no-store' }).then(async r => {
    if (!r.ok) throw new Error('로그인 상태를 확인해 주세요.');
    return (await r.json()).token;
  }).catch(e => { csrf = null; throw e; });
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return native(request);
    const headers = new Headers(request.headers);
    headers.set('X-Account-ID', account);
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return native(request, { headers });
    headers.set('X-CSRF-Token', await token());
    const retry = request.clone();
    let response = await native(request, { headers });
    if (response.status === 403 && (await response.clone().json()).code === 'csrf_failed') {
      csrf = null; headers.set('X-CSRF-Token', await token()); response = await native(retry, { headers });
    }
    return response;
  };
})();
