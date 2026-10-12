const PORT = Number(process.env.CDP_PORT ?? 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('ws')));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  return {
    ready,
    send: (method, params = {}) => {
      const i = ++id;
      ws.send(JSON.stringify({ id: i, method, params }));
      return new Promise((res, rej) => pending.set(i, { resolve: res, reject: rej }));
    },
    async eval(e) {
      const r = await this.send('Runtime.evaluate', {
        expression: e, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) return { __exc: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '') };
      return r.result?.value;
    },
  };
}
const http = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
const targets = await http('/json');
const panelInfo = targets.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel = cdp(panelInfo.webSocketDebuggerUrl);
await panel.ready;

// 直接在面板上下文测试 permissions.request 的行为
const probe = await panel.eval(`(async () => {
  const out = {};
  out.contains = await new Promise((res) => chrome.permissions.contains({origins:['<all_urls>']}, (v)=>res(v)));
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      chrome.permissions.request({origins:['<all_urls>']}),
      new Promise((res) => setTimeout(() => res('__PENDING__'), 4000)),
    ]);
    out.requestResult = r;
  } catch (e) {
    out.requestError = String(e && e.message ? e.message : e);
  }
  out.elapsed = Date.now() - t0;
  return out;
})()`);
console.log('probe:', JSON.stringify(probe, null, 2));
process.exit(0);
