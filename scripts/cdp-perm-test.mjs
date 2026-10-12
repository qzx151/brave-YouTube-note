// 正式（窄 host）构建：验证无截图权限时相机按钮给出明确错误提示，而不是静默失败
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
const targets = await http('/json');
const browser = cdp((await http('/json/version')).webSocketDebuggerUrl);
await browser.ready;
const extId = targets.find((t) => /background\.js/.test(t.url)).url.match(/\/\/([a-z]+)\//)[1];
console.log('ext:', extId);

const yt = targets.find((t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url));
await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
await sleep(2000);
await browser.send('Target.activateTarget', { targetId: yt.id });
await sleep(2500);

const list = await http('/json');
const panelInfo = list.find((t) => t.type === 'page' && /sidepanel\.html/.test(t.url));
const panel = cdp(panelInfo.webSocketDebuggerUrl);
await panel.ready;

const before = await panel.eval(`document.querySelectorAll('figure.screenshot-figure').length`);
// 点击相机按钮（真实用户手势）
await panel.eval(`document.querySelector('button[title*="截图"]').click()`);
await sleep(2500);
const after = await panel.eval(`(() => ({
  figures: document.querySelectorAll('figure.screenshot-figure').length,
  toast: document.querySelector('[data-testid="toast"], .toast, [role="alert"]')?.innerText ?? '',
  bodyTail: document.body.innerText.slice(-200),
}))()`);
console.log('before figures:', before);
console.log('after:', JSON.stringify(after, null, 2));
const ok = after.figures === 0 && /授权|权限/.test(after.toast + after.bodyTail);
console.log(ok ? 'PASS - 无权限时给出明确提示且未插入图片' : 'FAIL - 未出现可理解的权限提示');
process.exit(ok ? 0 : 1);
