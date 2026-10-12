// 浏览器完全重启后的持久化验证：打开视频 A + 面板，检查文本/时间戳/截图均恢复
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
      return r.result?.value;
    },
  };
}
const http = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
async function waitFor(fn, timeout = 20000, step = 500, label = '') {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) { last = String(e); }
    await sleep(step);
  }
  throw new Error(`waitFor timeout: ${label} last=${JSON.stringify(last)}`);
}

const targets = await http('/json');
const browser = cdp((await http('/json/version')).webSocketDebuggerUrl);
await browser.ready;
const extId = targets.find((t) => /background\.js/.test(t.url)).url.match(/\/\/([a-z]+)\//)[1];
const yt = targets.find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
await sleep(2000);
await browser.send('Target.activateTarget', { targetId: yt.id });

const list = await http('/json');
const panelInfo = list.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel = cdp(panelInfo.webSocketDebuggerUrl);
await panel.ready;

const restored = await waitFor(async () => {
  const v = await panel.eval(`(() => {
    const img = document.querySelector('figure.screenshot-figure img');
    return {
      text: document.querySelector('.ProseMirror')?.innerText ?? '',
      chip: document.querySelector('.ProseMirror .timestamp-chip')?.textContent?.trim() ?? '',
      figures: document.querySelectorAll('figure.screenshot-figure').length,
      imgLoaded: img ? img.complete && img.naturalWidth > 0 : false,
    };
  })()`);
  return /自动化测试笔记/.test(v.text) && v.chip && v.figures >= 1 && v.imgLoaded ? v : null;
}, 20000, 500, 'restored after browser restart');
console.log('RESTORED:', JSON.stringify(restored, null, 2));
console.log('PASS - 浏览器完全重启后笔记、时间戳与截图均恢复');
process.exit(0);
