export function createPlayServer({ onUpdate, onDisconnect }) {
  let base, token, timer, version = 0;
  async function request(action, body) {
    const response = await fetch(`${base}/lan-api/${action}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), credentials: 'omit', cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Play server unavailable');
    return result;
  }
  function disconnect() {
    version++; clearTimeout(timer);
    if (token) request('disconnect', {}).catch(() => {});
    token = null; onDisconnect();
  }
  async function poll(current) {
    try {
      const result = await request('poll');
      if (current !== version) return;
      await onUpdate(result);
      if (current === version) timer = setTimeout(() => poll(current), 1000);
    } catch (error) { if (current === version) { disconnect(); onDisconnect(error.message); } }
  }
  return {
    get connected() { return Boolean(token); }, request, disconnect,
    async connect(address) {
      disconnect();
      const url = new URL(address); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Use a play server HTTP(S) address.');
      base = url.origin; const current = version;
      const result = await request('connect', {});
      if (current !== version) return;
      token = result.token; await poll(current);
    }
  };
}
