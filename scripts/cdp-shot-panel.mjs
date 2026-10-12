// 在不激活面板标签的前提下截取面板内容（模拟真实侧边栏旁置场景）
import { writeFileSync } from 'node:fs';
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

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const browser = cdp((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl);
await browser.ready;
const yt = targets.find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
await browser.send('Target.activateTarget', { targetId: yt.id });
await sleep(2500); // 让面板轮询加载视频 A 笔记

const panelInfo = targets.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel = cdp(panelInfo.webSocketDebuggerUrl);
await panel.ready;
await panel.send('Page.enable');
const state = await panel.eval(`(() => ({
  header: document.querySelector('header')?.innerText ?? '',
  figures: document.querySelectorAll('figure.screenshot-figure').length,
  chips: document.querySelectorAll('.ProseMirror .timestamp-chip').length,
  text: document.querySelector('.ProseMirror')?.innerText?.slice(0,100) ?? '',
}))()`);
console.log('panel state:', JSON.stringify(state, null, 2));

const shot = await panel.send('Page.captureScreenshot', { format: 'png' });
const out = new URL('../.tmp/shots/04-panel-note-bg.png', import.meta.url);
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved 04-panel-note-bg.png');
process.exit(0);
