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
      if (r.exceptionDetails)
        return { __exc: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
      return r.result?.value;
    },
  };
}
const http = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();

const browser = cdp((await http('/json/version')).webSocketDebuggerUrl);
await browser.ready;
const targets0 = await http('/json');
const panelInfo0 = targets0.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel0 = cdp(panelInfo0.webSocketDebuggerUrl);
await panel0.ready;
await panel0.send('Page.reload');
await sleep(4000);
const yt0 = (await http('/json')).find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
await browser.send('Target.activateTarget', { targetId: yt0.id });
await sleep(3000);

const panelInfo = (await http('/json')).find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel = cdp(panelInfo.webSocketDebuggerUrl);
await panel.ready;

await panel.eval(`window.__errs=[]; const oe=console.error; console.error=(...a)=>{window.__errs.push(a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' '));oe(...a)}; 'ok'`);
await panel.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.title+x.innerText).includes('截图')); b && b.click(); return !!b; })()`);
let saw = false;
for (let i = 0; i < 12; i++) {
  await sleep(500);
  const s = await panel.eval(`({
    toasts: [...document.querySelectorAll('.fixed span')].map(s=>s.innerText).filter(Boolean),
    errs: window.__errs || [],
    busy: [...document.querySelectorAll('button')].some(b=>b.disabled),
  })`);
  console.log(`t=${((i+1)*0.5).toFixed(1)}s`, JSON.stringify(s));
  if (/授权|权限/.test((s.toasts || []).join(''))) saw = true;
}
console.log(saw ? 'PASS' : 'FAIL');
process.exit(saw ? 0 : 1);
