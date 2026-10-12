// 截图链路诊断：在面板/SW 上下文直接调用消息 API
const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error(`${label} ws error`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === 'runtime.consoleAPICalled') {
      const text = msg.params.args?.map((a) => a.value ?? a.description).join(' ');
      console.log(`[${label} console.${msg.params.type}]`, text);
    } else if (msg.method === 'runtime.exceptionThrown') {
      console.log(`[${label} exception]`, msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
    }
  });
  return {
    ready,
    send: (method, params = {}) => {
      const myId = ++id;
      ws.send(JSON.stringify({ id: myId, method, params }));
      return new Promise((resolve, reject) => pending.set(myId, { resolve, reject }));
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (r.exceptionDetails) {
        return { __evalError: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
      }
      return r.result.value;
    },
  };
}

const targets = await (await fetch(`${BASE}/json`)).json();
const panelInfo = targets.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const swInfo = targets.find((t) => t.type === 'service_worker' && /background\.js$/.test(t.url));
const ytInfo = targets.find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
console.log('panel:', !!panelInfo, 'sw:', swInfo?.url, 'yt:', ytInfo?.url);

const panel = cdpSession(panelInfo.webSocketDebuggerUrl, 'panel');
await panel.ready;
await panel.send('Runtime.enable');
await panel.send('Log.enable');

// 激活 YouTube 标签
const browser = cdpSession((await (await fetch(`${BASE}/json/version`)).json()).webSocketDebuggerUrl, 'browser');
await browser.ready;
await browser.send('Target.activateTarget', { targetId: ytInfo.id });
await sleep(1000);

const state = await panel.eval(`(async () => {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  const r = await chrome.tabs.sendMessage(tab.id, {type:'GET_VIDEO_STATE'});
  return { tabUrl: tab.url, state: r && r.data ? r.data : r };
})()`);
console.log('VIDEO STATE:', JSON.stringify(state, null, 2).slice(0, 1200));

const cap = await panel.eval(`(async () => {
  try {
    const r = await chrome.runtime.sendMessage({type:'CAPTURE_VISIBLE_TAB'});
    if (r && r.ok) return { ok: true, len: r.data.dataUrl.length, head: r.data.dataUrl.slice(0,40) };
    return { ok: false, resp: r };
  } catch (e) { return { threw: String(e && e.message || e) }; }
})()`);
console.log('CAPTURE VIA PANEL:', JSON.stringify(cap, null, 2));

// 直接在 SW 中调用一次
const sw = cdpSession(swInfo.webSocketDebuggerUrl, 'sw');
await sw.ready;
await sw.send('Runtime.enable');
await sw.send('Log.enable');
await sleep(300);
const capSw = await sw.eval(`(async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    const u = await chrome.tabs.captureVisibleTab(tab.windowId, {format:'png'});
    return { ok: true, len: u.length, tabUrl: tab.url, windowId: tab.windowId };
  } catch (e) { return { ok: false, err: String(e && e.message || e), name: e && e.name }; }
})()`);
console.log('CAPTURE IN SW:', JSON.stringify(capSw, null, 2));

// manifest 权限自检
const perms = await sw.eval(`chrome.runtime.getManifest()`);
console.log('MANIFEST permissions:', JSON.stringify(perms.permissions), 'host:', JSON.stringify(perms.host_permissions));
process.exit(0);
